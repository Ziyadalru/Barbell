import { NavigationContainer, useFocusEffect } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, StyleSheet, ScrollView, FlatList, SectionList, TouchableOpacity, StatusBar, Modal, TextInput, Alert, Animated, Dimensions, PanResponder, Easing, Vibration, Linking, KeyboardAvoidingView, Platform, Image, PixelRatio } from 'react-native';
import { PanGestureHandler, State, GestureHandlerRootView, Gesture, GestureDetector } from 'react-native-gesture-handler';
import React, { useState, useEffect, useCallback, useMemo, useRef, useContext } from 'react';

const AppActionsContext = React.createContext({ rerunOnboarding: () => {}, setTheme: () => {}, themeKey: 'grey', subscriptionActive: false, trialDaysLeft: 30, setShowPaywall: () => {} });

const THEME_KEY = 'displayTheme';
const THEMES = {
  grey: {
    accent: '#0A84FF',
    bg: '#1C1C1E', surface: '#2C2C2E', s2: '#3A3A3C', s3: '#48484A', sep: '#1C1C1E',
    t1: '#FFFFFF', t2: 'rgba(255,255,255,0.65)', t3: 'rgba(255,255,255,0.38)',
    border: 'rgba(255,255,255,0.12)', statusBar: 'light-content',
  },
  black: {
    accent: '#0A84FF',
    bg: '#000000', surface: '#111111', s2: '#1C1C1E', s3: '#2C2C2E', sep: '#000000',
    t1: '#FFFFFF', t2: 'rgba(255,255,255,0.60)', t3: 'rgba(255,255,255,0.35)',
    border: 'rgba(255,255,255,0.10)', statusBar: 'light-content',
  },
  light: {
    accent: '#0A84FF',
    bg: '#F2F2F7', surface: '#FFFFFF', s2: '#E5E5EA', s3: '#D1D1D6', sep: '#F2F2F7',
    t1: '#000000', t2: 'rgba(0,0,0,0.55)', t3: 'rgba(0,0,0,0.36)',
    border: 'rgba(0,0,0,0.10)', statusBar: 'dark-content',
  },
};
const ThemeContext = React.createContext(THEMES.grey);

import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Path, Ellipse, Rect, Defs, LinearGradient, RadialGradient, Stop, Text as SvgText } from 'react-native-svg';
import { entriesToObject, getJson, parseStoredJson, setJson } from './src/storage/jsonStorage';
import { getSupabaseFoodByBarcode, searchSupabaseFoods } from './src/supabase/foods';
import { supabase, isSupabaseConfigured } from './src/supabase/client';
import * as AppleAuthentication from 'expo-apple-authentication';
import {
  configureRevenueCat,
  getCustomerAccess,
  getPaywallPackages,
  isRevenueCatConfigured,
  purchaseRevenueCatPackage,
  restoreRevenueCatPurchases,
} from './src/billing/revenueCat';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';

const Tab = createBottomTabNavigator();

// ── DATE UTILS ────────────────────────────────────────────
const todayStr  = () => new Date().toISOString().split('T')[0];
const shiftDay  = (d, n) => { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().split('T')[0]; };
const dateStrFromParts = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const daysInMonth = (year, monthIndex) => new Date(year, monthIndex + 1, 0).getDate();
const MONTH_NAMES = Array.from({ length: 12 }, (_, i) => new Date(2026, i, 1).toLocaleDateString('en-US', { month: 'long' }));
const shiftMonth = (month, offset) => {
  const dt = new Date(month + 'T12:00:00');
  dt.setMonth(dt.getMonth() + offset);
  return dateStrFromParts(dt.getFullYear(), dt.getMonth(), 1);
};
const monthWindow = (month) => [shiftMonth(month, -1), month, shiftMonth(month, 1)];
const displayDate = (d) => {
  const t = todayStr();
  if (d === t)              return 'Today';
  if (d === shiftDay(t,-1)) return 'Yesterday';
  if (d === shiftDay(t, 1)) return 'Tomorrow';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const EMPTY_MEALS = [
  { name: 'Breakfast', items: [] },
  { name: 'Lunch',     items: [] },
  { name: 'Dinner',    items: [] },
  { name: 'Snacks',    items: [] },
];


// ── COLOURS ──────────────────────────────────────────────
const C = {
  accent:  '#0A84FF',
  bg:      '#1C1C1E',       // iOS dark background
  surface: '#2C2C2E',       // elevated card
  s2:      '#3A3A3C',       // secondary surface
  s3:      '#48484A',       // tertiary / track
  sep:     '#1C1C1E',
  t1:      '#FFFFFF',
  t2:      'rgba(255,255,255,0.65)',
  t3:      'rgba(255,255,255,0.38)',
  border:  'rgba(255,255,255,0.12)',
};

function useSwipeDismiss(onClose, resetKey) {
  const ty = useRef(new Animated.Value(0)).current;
  useEffect(() => { ty.setValue(0); }, [resetKey]);
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderMove: (_, { dy }) => { if (dy > 0) ty.setValue(dy); },
    onPanResponderRelease: (_, { dy, vy }) => {
      if (dy > 100 || vy > 1.2) {
        Animated.timing(ty, { toValue: 700, duration: 200, useNativeDriver: true }).start(onClose);
      } else {
        Animated.spring(ty, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
      }
    },
  })).current;
  return { ty, dragHandle: pan.panHandlers };
}

// ── HOME SCREEN ───────────────────────────────────────────
const GOALS_KEY      = 'userGoals';
const ONBOARDING_KEY = 'onboardingDone';
const DEFAULT_GOALS  = { calories: 2300, protein: 180, carbs: 250, fat: 70, fiber: 28, sugar: 50, satFat: 20, sodium: 2300 };

function HomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const C = useContext(ThemeContext);
  const styles = mkStyles(C);
  const [consumed,      setConsumed]      = useState(0);
  const [macros,        setMacros]        = useState({ p: 0, c: 0, f: 0 });
  const [goals,         setGoals]         = useState(DEFAULT_GOALS);
  const [streak,        setStreak]        = useState(0);
  const [lastWk,        setLastWk]        = useState(null);
  const [userName,      setUserName]      = useState('');
  const [coachOpen,     setCoachOpen]     = useState(false);
  const [trophiesOpen,  setTrophiesOpen]  = useState(false);
  const [achievements,  setAchievements]  = useState({});
  const [wkHistory,     setWkHistory]     = useState([]);
  const [nutritionDays, setNutritionDays] = useState([]);

  useFocusEffect(useCallback(() => {
    const today = todayStr();
    const last5 = Array.from({ length: 5 }, (_, i) => shiftDay(today, -(i + 1)));
    const allKeys = [`meals_${today}`, GOALS_KEY, WORKOUTS_KEY, PROFILE_KEY, ACHIEVEMENTS_KEY, ...last5.map(d => `meals_${d}`)];
    AsyncStorage.multiGet(allKeys).then(entries => {
      const byKey = entriesToObject(entries);
      const todayMeals = parseStoredJson(byKey[`meals_${today}`], []);
      const tCal = todayMeals.reduce((s, m) => s + m.items.reduce((a, i) => a + i.cal, 0), 0);
      const tP   = todayMeals.reduce((s, m) => s + m.items.reduce((a, i) => a + i.p,   0), 0);
      const tC   = todayMeals.reduce((s, m) => s + m.items.reduce((a, i) => a + i.c,   0), 0);
      const tF   = todayMeals.reduce((s, m) => s + m.items.reduce((a, i) => a + i.f,   0), 0);
      setConsumed(tCal);
      setMacros({ p: Math.round(tP), c: Math.round(tC), f: Math.round(tF) });
      const g = byKey[GOALS_KEY] ? parseStoredJson(byKey[GOALS_KEY], DEFAULT_GOALS) : DEFAULT_GOALS;
      setGoals(g);
      if (byKey[PROFILE_KEY]) { const p = parseStoredJson(byKey[PROFILE_KEY], {}); setUserName(p.name?.split(' ')[0] || ''); }
      const history = parseStoredJson(byKey[WORKOUTS_KEY], []);
      setWkHistory(history);
      setStreak(computeStreak(history));
      setLastWk(history[0] || null);

      const nutDays = [{ p: Math.round(tP), c: Math.round(tC), f: Math.round(tF) }, ...last5.map(d => {
        const meals = parseStoredJson(byKey[`meals_${d}`], []);
        return { p: Math.round(meals.reduce((s, m) => s + m.items.reduce((a, i) => a + (i.p||0), 0), 0)), c: 0, f: 0 };
      })];
      setNutritionDays(nutDays);

      const stored = parseStoredJson(byKey[ACHIEVEMENTS_KEY], {});
      const streak2 = computeStreak(history);
      const unlocked = computeUnlockedIds(history, streak2, tCal, { p: Math.round(tP), c: Math.round(tC), f: Math.round(tF) }, g, nutDays);
      let updated = { ...stored };
      let newUnlock = false;
      unlocked.forEach(id => { if (!updated[id]) { updated[id] = new Date().toISOString(); newUnlock = true; } });
      if (newUnlock) AsyncStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(updated));
      setAchievements(updated);
    });
  }, []));

  const hour          = new Date().getHours();
  const greeting      = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dayName       = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const remaining     = goals.calories - consumed;
  const daysSinceLast = lastWk?.date ? Math.floor((Date.now() - new Date(lastWk.date)) / 86400000) : null;

  const trainingStatus = lastWk?.date?.split('T')[0] === todayStr()
    ? { text: 'Trained today', color: '#30D158', icon: 'checkmark-circle' }
    : daysSinceLast === 1
      ? { text: 'Last trained yesterday', color: C.t3, icon: null }
        : daysSinceLast != null && daysSinceLast > 1
        ? { text: `${daysSinceLast} days since last session`, color: '#FF9F0A', icon: null }
        : { text: 'No workouts yet', color: C.t3, icon: null };

  const coachTip = streak >= 3
    ? `${streak}-day streak. Don't break it.`
    : macros.p > 0 && macros.p < goals.protein * 0.5 && hour > 14
      ? 'You\'re behind on protein today.'
      : consumed === 0
        ? 'Log your first meal to start tracking.'
        : daysSinceLast != null && daysSinceLast > 2
          ? 'Time to get back in the gym.'
          : 'Stay consistent. Results compound.';

  const unlockedCount = Object.keys(achievements).length;
  const recentDef = useMemo(() => {
    const entries = Object.entries(achievements);
    if (!entries.length) return null;
    entries.sort((a, b) => new Date(b[1]) - new Date(a[1]));
    return ACHIEVEMENT_DEFS.find(d => d.id === entries[0][0]) || null;
  }, [achievements]);
  const nextDef = useMemo(() => {
    const def = ACHIEVEMENT_DEFS.find(d => !achievements[d.id]);
    if (!def) return null;
    const progress = getAchievementProgress(def.id, wkHistory, streak, goals, nutritionDays);
    return { def, progress };
  }, [achievements, wkHistory, streak, goals, nutritionDays]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: C.bg }]}>
      <StatusBar barStyle={C.statusBar} />

      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 116 }} showsVerticalScrollIndicator={false}>

        {/* ── HEADER ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 18 }}>
          <Text style={{ fontSize: 12, fontWeight: '800', color: C.accent, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 5 }}>{dayName}</Text>
          <Text style={{ fontSize: 30, fontWeight: '900', color: C.t1, letterSpacing: -1, lineHeight: 35 }}>
            {greeting}{userName ? `, ${userName}` : ''}
          </Text>
        </View>

        {/* ── ACTION CARD ── */}
        <View style={{ marginHorizontal: 16, marginBottom: 12, borderRadius: 18, overflow: 'hidden', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }}>
          <View style={{ height: 3, backgroundColor: C.accent }} />
          <View style={{ padding: 15 }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: C.t3, letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: 12 }}>Today</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={() => navigation.navigate('Workout')} activeOpacity={0.85}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.accent, borderRadius: 13, paddingVertical: 15 }}>
                <Ionicons name="barbell-outline" size={18} color="#fff" />
                <Text style={{ fontSize: 15, fontWeight: '800', color: '#fff' }}>Start Workout</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate('Nutrition')} activeOpacity={0.85}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.s2, borderRadius: 13, paddingVertical: 15, borderWidth: 1, borderColor: C.border }}>
                <Ionicons name="restaurant-outline" size={18} color={C.t2} />
                <Text style={{ fontSize: 15, fontWeight: '800', color: C.t2 }}>Log Food</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ── TODAY'S NUTRITION ── */}
        <TouchableOpacity activeOpacity={0.85} onPress={() => navigation.navigate('Nutrition')}
          style={{ marginHorizontal: 16, marginBottom: 12, borderRadius: 18, overflow: 'hidden', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }}>
          <View style={{ paddingHorizontal: 15, paddingTop: 14, paddingBottom: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: C.t1, letterSpacing: -0.2 }}>Today's Nutrition</Text>
              <Text style={{ fontSize: 12, color: remaining < 0 ? '#FF453A' : C.t3, fontWeight: '700' }}>
                {remaining < 0 ? `${Math.abs(remaining)} kcal over` : `${remaining} kcal left`}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                <AnimatedRingProgress
                  size={88} stroke={8}
                  progress={goals.calories > 0 ? Math.min(consumed / goals.calories, 1) : 0}
                  color={remaining < 0 ? '#FF453A' : C.accent}
                />
                <View style={{ position: 'absolute', alignItems: 'center' }}>
                  <Text style={{ fontSize: 17, fontWeight: '900', color: C.t1, letterSpacing: -0.5 }}>{consumed}</Text>
                  <Text style={{ fontSize: 9, fontWeight: '800', color: C.t3, letterSpacing: 0.8 }}>KCAL</Text>
                </View>
              </View>
              <View style={{ flex: 1, gap: 10 }}>
                {[
                  { label: 'Protein', val: macros.p, goal: goals.protein, color: '#FFB340' },
                  { label: 'Carbs',   val: macros.c, goal: goals.carbs,   color: '#30D158' },
                  { label: 'Fat',     val: macros.f, goal: goals.fat,     color: '#BF5AF2' },
                ].map(row => {
                  const pct = row.goal > 0 ? Math.min(row.val / row.goal, 1) : 0;
                  return (
                    <View key={row.label}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <Text style={{ fontSize: 11, fontWeight: '800', color: row.color }}>{row.label}</Text>
                        <Text style={{ fontSize: 11, color: C.t3 }}>{row.val}g / {row.goal}g</Text>
                      </View>
                      <View style={{ height: 5, backgroundColor: C.s3, borderRadius: 3, overflow: 'hidden' }}>
                        <View style={{ height: '100%', width: `${pct * 100}%`, backgroundColor: row.color, borderRadius: 3 }} />
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>
        </TouchableOpacity>

        {/* ── TROPHIES ── */}
        <TouchableOpacity activeOpacity={0.85} onPress={() => setTrophiesOpen(true)}
          style={{ marginHorizontal: 16, marginBottom: 12, borderRadius: 16, overflow: 'hidden', backgroundColor: C.surface }}>
          <View style={{ flexDirection: 'row', overflow: 'hidden' }}>
            <View style={{ width: 4, backgroundColor: '#FFD60A' }} />
            <View style={{ flex: 1, paddingHorizontal: 14, paddingVertical: 13 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: recentDef || nextDef ? 12 : 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: C.t1 }}>Trophies</Text>
                  <View style={{ backgroundColor: '#FFD60A20', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 2 }}>
                    <Text style={{ fontSize: 11, fontWeight: '800', color: '#FFD60A' }}>{unlockedCount}/{ACHIEVEMENT_DEFS.length}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.s2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: C.t2 }}>See all</Text>
                  <Ionicons name="chevron-forward" size={12} color={C.t3} />
                </View>
              </View>

              {recentDef ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: nextDef ? 10 : 0 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: recentDef.color + '22', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 20 }}>{recentDef.emoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: C.t1 }}>{recentDef.name}</Text>
                    <Text style={{ fontSize: 11, color: C.t3 }}>{recentDef.desc}</Text>
                  </View>
                  <View style={{ backgroundColor: '#30D15820', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: '#30D158' }}>Unlocked</Text>
                  </View>
                </View>
              ) : (
                <Text style={{ fontSize: 13, color: C.t3, marginBottom: nextDef ? 10 : 0 }}>
                  Complete workouts to earn your first trophy.
                </Text>
              )}

              {nextDef && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 20, opacity: 0.4 }}>{nextDef.def.emoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: C.t2 }}>Next: {nextDef.def.name}</Text>
                    {nextDef.progress ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 }}>
                        <View style={{ flex: 1, height: 4, backgroundColor: C.s3, borderRadius: 2, overflow: 'hidden' }}>
                          <View style={{ width: `${(nextDef.progress.current / nextDef.progress.total) * 100}%`, height: '100%', backgroundColor: nextDef.def.color, borderRadius: 2 }} />
                        </View>
                        <Text style={{ fontSize: 10, color: C.t3 }}>{nextDef.progress.current}/{nextDef.progress.total}</Text>
                      </View>
                    ) : (
                      <Text style={{ fontSize: 11, color: C.t3, marginTop: 2 }}>{nextDef.def.desc}</Text>
                    )}
                  </View>
                </View>
              )}
            </View>
          </View>
        </TouchableOpacity>

        {/* ── AI COACH ── */}
        <TouchableOpacity activeOpacity={0.85} onPress={() => setCoachOpen(true)}
          style={{ marginHorizontal: 16, marginBottom: 12, borderRadius: 16, overflow: 'hidden', backgroundColor: C.surface }}>
          <View style={{ flexDirection: 'row', overflow: 'hidden' }}>
            <View style={{ width: 4, backgroundColor: '#BF5AF2' }} />
            <View style={{ flex: 1, paddingHorizontal: 14, paddingVertical: 13 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: C.t1 }}>Coach</Text>
                  <View style={{ backgroundColor: '#BF5AF218', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Text style={{ fontSize: 9, fontWeight: '800', color: '#BF5AF2', letterSpacing: 1 }}>AI</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.s2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: C.t2 }}>Ask</Text>
                  <Ionicons name="chevron-forward" size={12} color={C.t3} />
                </View>
              </View>
              <Text style={{ fontSize: 14, color: C.t2, lineHeight: 20 }}>{coachTip}</Text>
            </View>
          </View>
        </TouchableOpacity>

      </ScrollView>

      {coachOpen && (
        <CoachModal
          onClose={() => setCoachOpen(false)}
          userName={userName}
          streak={streak}
          consumed={consumed}
          macros={macros}
          goals={goals}
          daysSinceLast={daysSinceLast}
        />
      )}
      {trophiesOpen && (
        <AchievementsSheet
          onClose={() => setTrophiesOpen(false)}
          achievements={achievements}
          wkHistory={wkHistory}
          streak={streak}
          goals={goals}
          nutritionDays={nutritionDays}
        />
      )}
    </View>
  );
}

const FOOD_TAG    = /\[FOOD:(\{.*?\})\]/s;
const ROUTINE_TAG = /\[ROUTINE:(\{.*?\})\]/s;
const COACH_HISTORY_KEY = 'coachHistory';
const COACH_MAX_MESSAGES = 40;

function CoachModal({ onClose, userName, streak, consumed, macros, goals, daysSinceLast }) {
  const insets    = useSafeAreaInsets();
  const C         = useContext(ThemeContext);
  const styles    = mkStyles(C);
  const scrollRef = useRef(null);
  const [messages,    setMessages]    = useState([]);
  const [input,       setInput]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [addingFood,  setAddingFood]  = useState(null);

  const saveMessages = async (msgs) => {
    try { await AsyncStorage.setItem(COACH_HISTORY_KEY, JSON.stringify(msgs.slice(-COACH_MAX_MESSAGES))); } catch {}
  };

  const systemPrompt = [
    'You are a personal fitness coach inside the Barbellz app.',
    'You speak the same language the user writes in — Arabic or English.',
    'You help with strength training, workout programming, routines, nutrition, recipes, and calorie tracking.',
    'Be direct, practical, and encouraging. Max 4 sentences per reply.',
    `User: ${userName || 'athlete'}. Streak: ${streak} days.`,
    `Today nutrition: ${consumed}/${goals.calories} kcal, ${macros.p}g/${goals.protein}g protein, ${macros.c}g carbs, ${macros.f}g fat.`,
    daysSinceLast != null ? `Days since last workout: ${daysSinceLast}.` : 'No workouts logged yet.',
    'RULE 1 — Food: When you give nutritional info for a specific food or recipe (one portion), append at the very end:',
    '[FOOD:{"name":"<name>","cal":<kcal>,"p":<protein_g>,"c":<carbs_g>,"f":<fat_g>}]',
    'RULE 2 — Routine: When you create a workout routine, append at the very end:',
    '[ROUTINE:{"name":"<routine name>","exercises":[{"name":"<exercise>","muscle":"<muscle group>"},...]}]',
    'Include 4–7 exercises. Only append one tag per reply. Never add text after the tag.',
  ].join(' ');

  useEffect(() => {
    AsyncStorage.getItem(COACH_HISTORY_KEY).then(raw => {
      const saved = parseStoredJson(raw, []);
      if (saved.length > 0) {
        setMessages(saved);
      } else {
        setMessages([{ role: 'assistant', text: buildOpener(streak, consumed, macros, goals, daysSinceLast, userName), food: null }]);
      }
    });
  }, []);

  useEffect(() => {
    if (messages.length > 0) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, [messages]);

  const newChat = () => {
    Alert.alert('New Chat', 'Start a fresh conversation? This will clear the current chat.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'New Chat', onPress: async () => {
        const opener = [{ role: 'assistant', text: buildOpener(streak, consumed, macros, goals, daysSinceLast, userName), food: null }];
        setMessages(opener);
        await saveMessages(opener);
      }},
    ]);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    const updated = [...messages, { role: 'user', text, food: null, routine: null }];
    setMessages(updated);
    saveMessages(updated);
    setLoading(true);
    try {
      const res = await fetch(AI_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'user', content: systemPrompt },
            ...updated.map(m => ({ role: m.role, content: m.text })),
          ],
          max_tokens: 300,
        }),
      });
      const data  = await res.json();
      const raw   = data.choices?.[0]?.message?.content?.trim() || 'Try again.';

      let food = null, routine = null, displayText = raw;
      const foodMatch    = raw.match(FOOD_TAG);
      const routineMatch = raw.match(ROUTINE_TAG);
      if (foodMatch) {
        try { food = JSON.parse(foodMatch[1]); } catch {}
        displayText = raw.replace(FOOD_TAG, '').trim();
      } else if (routineMatch) {
        try { routine = JSON.parse(routineMatch[1]); } catch {}
        displayText = raw.replace(ROUTINE_TAG, '').trim();
      }
      setMessages(prev => {
        const next = [...prev, { role: 'assistant', text: displayText, food, routine }];
        saveMessages(next);
        return next;
      });
    } catch {
      setMessages(prev => {
        const next = [...prev, { role: 'assistant', text: 'Connection error. Try again.', food: null, routine: null }];
        saveMessages(next);
        return next;
      });
    }
    setLoading(false);
  };

  const addToLog = async (food, mealName) => {
    const key   = `meals_${todayStr()}`;
    const raw   = await AsyncStorage.getItem(key);
    const meals = parseStoredJson(raw, [...EMPTY_MEALS]);
    const idx   = meals.findIndex(m => m.name === mealName);
    if (idx >= 0) {
      meals[idx].items.push({ id: `${Date.now()}`, name: food.name, cal: food.cal, p: food.p, c: food.c, f: food.f, servings: 1 });
    }
    await AsyncStorage.setItem(key, JSON.stringify(meals));
    setAddingFood(null);
    Alert.alert('Added', `${food.name} added to ${mealName}.`);
  };

  const saveRoutine = async (routine) => {
    const raw      = await AsyncStorage.getItem(ROUTINES_KEY);
    const existing = parseStoredJson(raw, []);
    const newR     = {
      id: `${Date.now()}`,
      name: routine.name,
      exercises: (routine.exercises || []).map(e => ({
        exerciseId: `custom_${e.name.toLowerCase().replace(/\s+/g, '_')}`,
        name: e.name,
        muscle: e.muscle || '',
      })),
    };
    await AsyncStorage.setItem(ROUTINES_KEY, JSON.stringify([...existing, newR]));
    Alert.alert('Routine Saved', `"${routine.name}" added to your routines.`);
  };

  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {/* Header */}
        <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 0.5, borderBottomColor: C.border, flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={onClose} style={{ marginRight: 14 }}>
            <Ionicons name="chevron-down" size={24} color={C.t1} />
          </TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: '700', color: C.t1, flex: 1 }}>Coach</Text>
          <View style={{ backgroundColor: '#BF5AF218', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, marginRight: 12 }}>
            <Text style={{ fontSize: 10, fontWeight: '800', color: '#BF5AF2', letterSpacing: 1 }}>AI</Text>
          </View>
          <TouchableOpacity onPress={newChat} hitSlop={10}>
            <Ionicons name="create-outline" size={20} color={C.t2} />
          </TouchableOpacity>
        </View>

        {/* Messages */}
        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 12 }} showsVerticalScrollIndicator={false}>
          {messages.map((m, i) => (
            <View key={i} style={{ alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <View style={{
                maxWidth: '82%',
                backgroundColor: m.role === 'user' ? C.accent : C.surface,
                borderRadius: 16,
                borderBottomRightRadius: m.role === 'user' ? 4 : 16,
                borderBottomLeftRadius: m.role === 'user' ? 16 : 4,
                paddingHorizontal: 14, paddingVertical: 10,
              }}>
                <Text style={{ fontSize: 15, color: m.role === 'user' ? '#fff' : C.t1, lineHeight: 22 }}>{m.text}</Text>

                {/* Routine card + Save */}
                {m.routine && (
                  <View style={{ marginTop: 10, borderTopWidth: 0.5, borderTopColor: C.border, paddingTop: 10 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: C.t1, marginBottom: 8 }}>{m.routine.name}</Text>
                    {(m.routine.exercises || []).map((ex, ei) => (
                      <View key={ei} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: C.accent }} />
                        <Text style={{ fontSize: 13, color: C.t2, flex: 1 }}>{ex.name}</Text>
                        {ex.muscle ? <Text style={{ fontSize: 11, color: C.t3 }}>{ex.muscle}</Text> : null}
                      </View>
                    ))}
                    <TouchableOpacity onPress={() => saveRoutine(m.routine)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.accent + '18', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, alignSelf: 'flex-start', marginTop: 10 }}>
                      <Ionicons name="bookmark-outline" size={15} color={C.accent} />
                      <Text style={{ fontSize: 13, fontWeight: '700', color: C.accent }}>Save Routine</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Food macros + Add to Log */}
                {m.food && (
                  <View style={{ marginTop: 10, borderTopWidth: 0.5, borderTopColor: C.border, paddingTop: 10 }}>
                    <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                      <View style={{ backgroundColor: C.s2, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: C.t1 }}>{m.food.cal} kcal</Text>
                      </View>
                      {[
                        { label: `${m.food.p}g P`, color: '#FFB340' },
                        { label: `${m.food.c}g C`, color: '#30D158' },
                        { label: `${m.food.f}g F`, color: '#BF5AF2' },
                      ].map(chip => (
                        <View key={chip.label} style={{ backgroundColor: chip.color + '22', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                          <Text style={{ fontSize: 12, fontWeight: '700', color: chip.color }}>{chip.label}</Text>
                        </View>
                      ))}
                    </View>

                    {addingFood?.msgIndex === i ? (
                      <View>
                        <Text style={{ fontSize: 11, color: C.t3, marginBottom: 6 }}>Add to which meal?</Text>
                        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                          {['Breakfast', 'Lunch', 'Dinner', 'Snacks'].map(meal => (
                            <TouchableOpacity key={meal} onPress={() => addToLog(m.food, meal)}
                              style={{ backgroundColor: C.accent, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }}>
                              <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>{meal}</Text>
                            </TouchableOpacity>
                          ))}
                          <TouchableOpacity onPress={() => setAddingFood(null)}
                            style={{ backgroundColor: C.s2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }}>
                            <Text style={{ fontSize: 12, fontWeight: '600', color: C.t3 }}>Cancel</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity onPress={() => setAddingFood({ food: m.food, msgIndex: i })}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.accent + '18', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, alignSelf: 'flex-start' }}>
                        <Ionicons name="add-circle-outline" size={15} color={C.accent} />
                        <Text style={{ fontSize: 13, fontWeight: '700', color: C.accent }}>Add to Log</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            </View>
          ))}
          {loading && (
            <View style={{ alignItems: 'flex-start' }}>
              <View style={{ backgroundColor: C.surface, borderRadius: 16, borderBottomLeftRadius: 4, paddingHorizontal: 16, paddingVertical: 12 }}>
                <Text style={{ color: C.t3, fontSize: 20, letterSpacing: 4 }}>···</Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Input */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: insets.bottom + 12, borderTopWidth: 0.5, borderTopColor: C.border }}>
            <TextInput
              style={{ flex: 1, backgroundColor: C.surface, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 11, color: C.t1, fontSize: 15 }}
              placeholder="Ask about recipes, calories, training…"
              placeholderTextColor={C.t3}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={send}
              returnKeyType="send"
              multiline={false}
            />
            <TouchableOpacity onPress={send} disabled={!input.trim() || loading}
              style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: input.trim() && !loading ? C.accent : C.s2, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="arrow-up" size={18} color={input.trim() && !loading ? '#fff' : C.t3} />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function buildOpener(streak, consumed, macros, goals, daysSinceLast, userName) {
  const name = userName ? userName : null;
  const hi = name ? `Hey ${name}.` : 'Hey.';
  if (streak >= 5) return `${hi} ${streak}-day streak — you're building something real. What's on your mind?`;
  if (streak >= 2) return `${hi} ${streak} days in a row. Keep asking me anything about training or nutrition.`;
  if (consumed > 0 && macros.p < goals.protein * 0.4) return `${hi} You're low on protein today. Ask me how to fix that.`;
  if (daysSinceLast != null && daysSinceLast > 3) return `${hi} It's been ${daysSinceLast} days since your last session. Let's talk about getting back.`;
  return `${hi} I'm your personal coach. Ask me about your training, nutrition, or anything fitness-related.`;
}

function AchievementsSheet({ onClose, achievements, wkHistory, streak, goals, nutritionDays }) {
  const insets = useSafeAreaInsets();
  const C = useContext(ThemeContext);
  const { ty, dragHandle } = useSwipeDismiss(onClose, 'ach');

  const unlockedCount = Object.keys(achievements).length;

  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={{ flex: 1, backgroundColor: C.bg, transform: [{ translateY: ty }] }}>
        {/* Header */}
        <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 0.5, borderBottomColor: C.border, flexDirection: 'row', alignItems: 'center' }} {...dragHandle}>
          <TouchableOpacity onPress={onClose} style={{ marginRight: 14 }}>
            <Ionicons name="chevron-down" size={24} color={C.t1} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: C.t1 }}>Trophies</Text>
          </View>
          <View style={{ backgroundColor: '#FFD60A20', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ fontSize: 13, fontWeight: '800', color: '#FFD60A' }}>{unlockedCount}/{ACHIEVEMENT_DEFS.length}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }} showsVerticalScrollIndicator={false}>
          {/* Unlocked section */}
          {unlockedCount > 0 && (
            <>
              <Text style={{ fontSize: 12, fontWeight: '700', color: C.t3, letterSpacing: 1, marginBottom: 4 }}>UNLOCKED</Text>
              {ACHIEVEMENT_DEFS.filter(d => achievements[d.id]).map(def => {
                const unlockedAt = new Date(achievements[def.id]);
                const daysAgo = Math.floor((Date.now() - unlockedAt) / 86400000);
                const whenStr = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo} days ago`;
                return (
                  <View key={def.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.surface, borderRadius: 14, padding: 14 }}>
                    <View style={{ width: 50, height: 50, borderRadius: 14, backgroundColor: def.color + '22', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 26 }}>{def.emoji}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: C.t1 }}>{def.name}</Text>
                      <Text style={{ fontSize: 12, color: C.t3, marginTop: 2 }}>{def.desc}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <View style={{ backgroundColor: '#30D15820', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: '#30D158' }}>✓</Text>
                      </View>
                      <Text style={{ fontSize: 10, color: C.t3 }}>{whenStr}</Text>
                    </View>
                  </View>
                );
              })}
            </>
          )}

          {/* Locked section */}
          {unlockedCount < ACHIEVEMENT_DEFS.length && (
            <>
              <Text style={{ fontSize: 12, fontWeight: '700', color: C.t3, letterSpacing: 1, marginBottom: 4, marginTop: unlockedCount > 0 ? 8 : 0 }}>LOCKED</Text>
              {ACHIEVEMENT_DEFS.filter(d => !achievements[d.id]).map(def => {
                const progress = getAchievementProgress(def.id, wkHistory, streak, goals, nutritionDays);
                return (
                  <View key={def.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.surface, borderRadius: 14, padding: 14, opacity: 0.6 }}>
                    <View style={{ width: 50, height: 50, borderRadius: 14, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 26, opacity: 0.35 }}>{def.emoji}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: C.t1 }}>{def.name}</Text>
                      <Text style={{ fontSize: 12, color: C.t3, marginTop: 2 }}>{def.desc}</Text>
                      {progress && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 }}>
                          <View style={{ flex: 1, height: 3, backgroundColor: C.s3, borderRadius: 2, overflow: 'hidden' }}>
                            <View style={{ width: `${(progress.current / progress.total) * 100}%`, height: '100%', backgroundColor: def.color, borderRadius: 2 }} />
                          </View>
                          <Text style={{ fontSize: 10, color: C.t3 }}>{progress.current}/{progress.total}</Text>
                        </View>
                      )}
                    </View>
                    <Ionicons name="lock-closed" size={14} color={C.t3} />
                  </View>
                );
              })}
            </>
          )}

          {unlockedCount === ACHIEVEMENT_DEFS.length && (
            <View style={{ alignItems: 'center', paddingVertical: 32 }}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>🏆</Text>
              <Text style={{ fontSize: 18, fontWeight: '800', color: C.t1, marginBottom: 6 }}>All trophies unlocked!</Text>
              <Text style={{ fontSize: 14, color: C.t3 }}>You're an absolute beast.</Text>
            </View>
          )}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

// ── WORKOUT DATA ─────────────────────────────────────────
const WORKOUTS_KEY = 'workoutHistory';
const ROUTINES_KEY = 'workoutRoutines';
const MUSCLES        = ['All','Chest','Back','Shoulders','Biceps','Triceps','Legs','Glutes','Core'];
const WEIGHT_LOG_KEY   = 'weightLog';
const PROFILE_KEY      = 'userProfile';
const UNITS_KEY             = 'weightUnit';
const CUSTOM_EXERCISES_KEY  = 'customExercises';
const REST_DEFAULT          = 90;
const REST_TIMER_KEY        = 'restTimerSecs';
const TRIAL_KEY        = 'trialStartDate';
const TRIAL_DAYS       = 14;
const PR_NAMES       = ['Bench Press', 'Squat', 'Deadlift', 'Overhead Press'];

const ACHIEVEMENTS_KEY = 'userAchievements';
const ACHIEVEMENT_DEFS = [
  { id: 'first_rep',       emoji: '🏋️', name: 'First Rep',        desc: 'Complete your first workout',              color: '#30D158' },
  { id: 'on_a_roll',       emoji: '🔥', name: 'On a Roll',         desc: '3-day workout streak',                     color: '#FF9F0A' },
  { id: 'iron_week',       emoji: '⚡', name: 'Iron Week',         desc: '7-day workout streak',                     color: '#FFD60A' },
  { id: 'dedicated',       emoji: '💎', name: 'Dedicated',         desc: '30-day workout streak',                    color: '#BF5AF2' },
  { id: 'getting_started', emoji: '🎯', name: 'Getting Started',   desc: 'Log 10 workouts',                         color: '#0A84FF' },
  { id: 'committed',       emoji: '🏅', name: 'Committed',         desc: 'Log 50 workouts',                         color: '#32ADE6' },
  { id: 'centurion',       emoji: '🏆', name: 'Centurion',         desc: 'Log 100 workouts',                        color: '#FFD60A' },
  { id: 'heavy_hitter',    emoji: '💪', name: 'Heavy Hitter',      desc: 'Log a set at 100 kg or more',             color: '#FF453A' },
  { id: 'variety',         emoji: '🌟', name: 'Variety Pack',      desc: 'Train 5 different exercises',             color: '#32ADE6' },
  { id: 'first_meal',      emoji: '🥗', name: 'First Meal',        desc: 'Log your first meal',                     color: '#30D158' },
  { id: 'macro_master',    emoji: '🎯', name: 'Macro Master',      desc: 'Hit all macro goals in one day',          color: '#0A84FF' },
  { id: 'protein_king',    emoji: '🥩', name: 'Protein King',      desc: 'Hit your protein goal 5 days in a row',   color: '#FF9F0A' },
];

function computeUnlockedIds(history, streak, consumed, macros, goals, nutritionDays) {
  const ids = new Set();
  if (history.length >= 1)   ids.add('first_rep');
  if (streak >= 3)           ids.add('on_a_roll');
  if (streak >= 7)           ids.add('iron_week');
  if (streak >= 30)          ids.add('dedicated');
  if (history.length >= 10)  ids.add('getting_started');
  if (history.length >= 50)  ids.add('committed');
  if (history.length >= 100) ids.add('centurion');
  const hasHeavy = history.some(w => (w.exercises || []).some(ex => (ex.sets || []).some(s => parseFloat(s.weight) >= 100)));
  if (hasHeavy) ids.add('heavy_hitter');
  const uniqueEx = new Set(); history.forEach(w => (w.exercises||[]).forEach(ex => { if (ex.name) uniqueEx.add(ex.name); }));
  if (uniqueEx.size >= 5) ids.add('variety');
  if (consumed > 0) ids.add('first_meal');
  if (goals.protein > 0 && goals.carbs > 0 && goals.fat > 0 && macros.p >= goals.protein && macros.c >= goals.carbs && macros.f >= goals.fat) ids.add('macro_master');
  let proteinRun = 0;
  for (const day of nutritionDays) { if (goals.protein > 0 && day.p >= goals.protein) proteinRun++; else break; }
  if (proteinRun >= 5) ids.add('protein_king');
  return ids;
}

function getAchievementProgress(id, history, streak, goals, nutritionDays) {
  switch (id) {
    case 'first_rep':       return { current: Math.min(history.length, 1), total: 1 };
    case 'on_a_roll':       return { current: Math.min(streak, 3), total: 3 };
    case 'iron_week':       return { current: Math.min(streak, 7), total: 7 };
    case 'dedicated':       return { current: Math.min(streak, 30), total: 30 };
    case 'getting_started': return { current: Math.min(history.length, 10), total: 10 };
    case 'committed':       return { current: Math.min(history.length, 50), total: 50 };
    case 'centurion':       return { current: Math.min(history.length, 100), total: 100 };
    case 'variety': {
      const n = new Set(); history.forEach(w => (w.exercises||[]).forEach(ex => { if (ex.name) n.add(ex.name); }));
      return { current: Math.min(n.size, 5), total: 5 };
    }
    case 'protein_king': {
      let c = 0; for (const day of nutritionDays) { if (goals.protein > 0 && day.p >= goals.protein) c++; else break; }
      return { current: Math.min(c, 5), total: 5 };
    }
    default: return null;
  }
}

const computeStreak = (history) => {
  if (!history.length) return 0;
  const days = new Set(history.map(w => w.date?.split('T')[0]).filter(Boolean));
  let streak = 0;
  const d = new Date();
  if (!days.has(d.toISOString().split('T')[0])) d.setDate(d.getDate() - 1);
  while (days.has(d.toISOString().split('T')[0])) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
};

const computePRs = (history, names) => {
  const prs = {};
  for (const n of names) prs[n] = { weight: 0, date: null };
  for (const w of history) {
    for (const ex of (w.exercises || [])) {
      if (prs[ex.name] !== undefined) {
        for (const s of (ex.sets || [])) {
          const wt = parseFloat(s.weight) || 0;
          if (wt > prs[ex.name].weight) prs[ex.name] = { weight: wt, date: w.date };
        }
      }
    }
  }
  return prs;
};

const MUSCLE_META = {
  Chest:     { color: '#FF6B6B' },
  Back:      { color: '#32ADE6' },
  Shoulders: { color: '#30D158' },
  Biceps:    { color: '#FFB340' },
  Triceps:   { color: '#BF5AF2' },
  Legs:      { color: '#FF9F0A' },
  Glutes:    { color: '#FF375F' },
  Core:      { color: '#64D2FF' },
};

const EQUIP_ICON = {
  Barbell:    'barbell-outline',
  Dumbbell:   'layers-outline',
  Cable:      'swap-horizontal-outline',
  Machine:    'grid-outline',
  Bodyweight: 'body-outline',
  Kettlebell: 'fitness-outline',
  Other:      'ellipsis-horizontal-outline',
};

const MUSCLE_ICON = {
  Chest:     'body-outline',
  Back:      'trail-sign-outline',
  Shoulders: 'accessibility-outline',
  Biceps:    'barbell-outline',
  Triceps:   'fitness-outline',
  Legs:      'walk-outline',
  Glutes:    'ellipse-outline',
  Core:      'shield-outline',
};

// ── MUSCLE SVG ANATOMY ──────────────────────────────────
const MuscleSVG = React.memo(function MuscleSVG({ muscle, size = 48 }) {
  const C = useContext(ThemeContext);
  const H = Math.round(size * 1.3);
  const body = 'rgba(255,255,255,0.13)';
  const hi   = MUSCLE_META[muscle]?.color || C.accent;

  const Base = () => (
    <>
      <Circle cx={30} cy={8}   r={6.5} fill={body} />
      <Rect x={27}  y={13.5} width={6}  height={5}  rx={2} fill={body} />
      <Rect x={15}  y={17}   width={30} height={30} rx={8} fill={body} />
      <Rect x={6}   y={17}   width={8}  height={25} rx={4} fill={body} />
      <Rect x={46}  y={17}   width={8}  height={25} rx={4} fill={body} />
      <Rect x={16}  y={46}   width={11} height={26} rx={5} fill={body} />
      <Rect x={33}  y={46}   width={11} height={26} rx={5} fill={body} />
    </>
  );

  const Highlight = () => {
    switch (muscle) {
      case 'Chest':
        return (<>
          <Ellipse cx={23} cy={26} rx={5.5} ry={4.5} fill={hi} />
          <Ellipse cx={37} cy={26} rx={5.5} ry={4.5} fill={hi} />
        </>);
      case 'Shoulders':
        return (<>
          <Ellipse cx={9}  cy={21} rx={5} ry={5.5} fill={hi} />
          <Ellipse cx={51} cy={21} rx={5} ry={5.5} fill={hi} />
        </>);
      case 'Biceps':
        return (<>
          <Ellipse cx={9}  cy={25} rx={3.5} ry={5} fill={hi} />
          <Ellipse cx={51} cy={25} rx={3.5} ry={5} fill={hi} />
        </>);
      case 'Triceps':
        return (<>
          <Ellipse cx={9}  cy={32} rx={3.5} ry={5} fill={hi} />
          <Ellipse cx={51} cy={32} rx={3.5} ry={5} fill={hi} />
        </>);
      case 'Back':
        return (<>
          <Rect x={18} y={18} width={24} height={8}  rx={4} fill={hi} />
          <Rect x={15} y={27} width={7}  height={14} rx={3} fill={hi} />
          <Rect x={38} y={27} width={7}  height={14} rx={3} fill={hi} />
        </>);
      case 'Core':
        return (<>
          <Rect x={23} y={27} width={6} height={5} rx={2} fill={hi} />
          <Rect x={31} y={27} width={6} height={5} rx={2} fill={hi} />
          <Rect x={23} y={34} width={6} height={5} rx={2} fill={hi} />
          <Rect x={31} y={34} width={6} height={5} rx={2} fill={hi} />
          <Rect x={23} y={41} width={6} height={4} rx={2} fill={hi} />
          <Rect x={31} y={41} width={6} height={4} rx={2} fill={hi} />
        </>);
      case 'Legs':
        return (<>
          <Rect x={16} y={46} width={11} height={16} rx={5} fill={hi} />
          <Rect x={33} y={46} width={11} height={16} rx={5} fill={hi} />
        </>);
      case 'Glutes':
        return (<>
          <Ellipse cx={22} cy={49} rx={7} ry={5.5} fill={hi} />
          <Ellipse cx={38} cy={49} rx={7} ry={5.5} fill={hi} />
        </>);
      default:
        return null;
    }
  };

  return (
    <Svg width={size} height={H} viewBox="0 0 60 75">
      <Base />
      <Highlight />
    </Svg>
  );
});

// ── MUSCLE BADGE (inline icon for exercise rows) ────────
const MuscleAnatomy = React.memo(function MuscleAnatomy({ muscle, size = 22, color }) {
  const C = useContext(ThemeContext);
  const c = color || MUSCLE_META[muscle]?.color || C.accent;
  const box = Math.max(size + 12, 32);
  return (
    <View style={{
      width: box, height: box, borderRadius: Math.round(box / 2),
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: c + '22', borderWidth: 1, borderColor: c + '55',
    }}>
      <Ionicons name={MUSCLE_ICON[muscle] || 'fitness-outline'} size={size} color={c} />
    </View>
  );
});

// ── MUSCLE SPRITE ─────────────────────────────────────────
const MUSCLE_SPRITE_SRC = require('./assets/muscle-icons.png');
const SPRITE_COLS = 4;
const SPRITE_ROWS = 9;
const SPRITE_W    = 704;
const SPRITE_H    = 1524;
const CELL_W      = SPRITE_W / SPRITE_COLS;  // 176
const CELL_H      = SPRITE_H / SPRITE_ROWS;  // ~169.3

const MUSCLE_SPRITE_MAP = {
  Chest:     { list: 1,  detail: 1  },
  Back:      { list: 14, detail: 14 },
  Shoulders: { list: 2,  detail: 2  },
  Biceps:    { list: 5,  detail: 7  },
  Triceps:   { list: 6,  detail: 8  },
  Legs:      { list: 25, detail: 25 },
  Glutes:    { list: 28, detail: 28 },
  Core:      { list: 17, detail: 17 },
};

const MuscleSprite = React.memo(function MuscleSprite({ muscle, size = 44, detail = false }) {
  const C = useContext(ThemeContext);
  const map = MUSCLE_SPRITE_MAP[muscle];
  if (!map) return null;
  const pos          = detail ? map.detail : map.list;
  const row          = Math.floor((pos - 1) / SPRITE_COLS);
  const col          = (pos - 1) % SPRITE_COLS;
  const zoom         = 1.18;
  const scale        = (size * zoom) / CELL_W;
  const cellW        = CELL_W * scale;
  const cellH        = CELL_H * scale;
  const left         = -(col * cellW) - (cellW - size) / 2;
  const top          = -(row * cellH) - (cellH - size) / 2;
  return (
    <View style={{ width: size, height: size, overflow: 'hidden', borderRadius: 10, backgroundColor: C.surface }}>
      <Image
        source={MUSCLE_SPRITE_SRC}
        style={{ width: SPRITE_W * scale, height: SPRITE_H * scale, position: 'absolute', left, top }}
        resizeMode="stretch"
      />
    </View>
  );
});

const PremiumTabIcon = React.memo(function PremiumTabIcon({ focused, color, icon, activeIcon }) {
  return <Ionicons name={focused ? activeIcon : icon} size={24} color={color} />;
});

function WorkoutShareModal({ visible, onClose, workout }) {
  const C          = useContext(ThemeContext);
  const insets     = useSafeAreaInsets();
  const cameraRef  = useRef(null);
  const previewRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [phase,    setPhase]   = useState('camera');
  const [photoUri, setPhotoUri] = useState(null);
  const [sharing,  setSharing]  = useState(false);
  const [facing,   setFacing]   = useState('back');

  useEffect(() => {
    if (!visible) { setPhase('camera'); setPhotoUri(null); setSharing(false); }
  }, [visible]);

  if (!workout) return null;

  const setsCount = workout.exercises?.reduce((sum, e) => sum + (e.sets?.length || 0), 0) || 0;
  const CTRL_H    = 110 + insets.bottom;

  const takePicture = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 1.0 });
      setPhotoUri(photo.uri);
      setPhase('preview');
    } catch { Alert.alert('Error', 'Could not take photo.'); }
  };

  const doShare = async () => {
    try {
      setSharing(true);
      const uri = await captureRef(previewRef, { format: 'jpg', quality: 0.95, pixelRatio: PixelRatio.get() });
      await Sharing.shareAsync(uri, { mimeType: 'image/jpeg' });
    } catch (e) { Alert.alert('Could not share', e.message); }
    finally { setSharing(false); }
  };

  const volStr = (workout.volume || 0) >= 1000
    ? `${((workout.volume || 0) / 1000).toFixed(1)}k`
    : String(Math.round(workout.volume || 0));

  const sh = {};

  const statsPanel = (forCapture) => {
    const barTop = forCapture ? 0 : insets.top;
    return (
      <View style={{
        position: 'absolute', left: 0, right: 0,
        top: barTop, bottom: 0,
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingBottom: forCapture ? insets.bottom + 115 : CTRL_H + 115,
      }}>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.3,
            textAlign: 'center', paddingHorizontal: 28, ...sh }} numberOfLines={1}>
            {workout.name}
          </Text>

          <View style={{ width: 28, height: 2, backgroundColor: '#0A84FF', borderRadius: 2, marginTop: 8, marginBottom: 14 }} />

          <View style={{ flexDirection: 'row', gap: 24 }}>
            {[
              { val: fmtDuration(workout.duration || 0), lbl: 'DURATION' },
              { val: `${volStr} kg`,                      lbl: 'VOLUME'   },
              { val: String(setsCount),                   lbl: 'SETS'     },
            ].map(s => (
              <View key={s.lbl} style={{ alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: -0.2, ...sh }}>
                  {s.val}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: '700',
                  letterSpacing: 1.2, marginTop: 3, ...sh }}>
                  {s.lbl}
                </Text>
              </View>
            ))}
          </View>

          <Text style={{ color: '#0A84FF', fontSize: 11, fontWeight: '800', letterSpacing: 2.5, marginTop: 12, ...sh }}>
            BARBELLZ
          </Text>
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent={false} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>

        {phase === 'camera' ? (
          permission?.granted ? (
            <>
              {/* Camera full bleed */}
              <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} />

              {/* Stats above controls — NOT captured, just for framing */}
              {statsPanel(false)}

              {/* Solid black controls bar — clearly below the camera + stats */}
              <View style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                height: CTRL_H,
                backgroundColor: '#000',
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: 56, paddingBottom: insets.bottom,
              }}>
                <TouchableOpacity
                  onPress={() => setFacing(f => f === 'front' ? 'back' : 'front')}
                  style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Ionicons name="camera-reverse" size={22} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={takePicture} activeOpacity={0.85} style={{ width: 76, height: 76, borderRadius: 38, borderWidth: 3, borderColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff' }} />
                </TouchableOpacity>
                <View style={{ width: 44 }} />
              </View>
            </>
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
              <Ionicons name="camera-outline" size={48} color={C.t3} style={{ marginBottom: 16 }} />
              <Text style={{ color: C.t1, fontSize: 17, fontWeight: '700', marginBottom: 8 }}>Camera Access Needed</Text>
              <Text style={{ color: C.t3, fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
                {permission?.canAskAgain === false
                  ? 'Camera access was denied. Open Settings to enable it for Barbellz.'
                  : 'Allow camera access to take a photo with your workout stats.'}
              </Text>
              {permission?.canAskAgain === false ? (
                <TouchableOpacity onPress={() => Linking.openSettings()}
                  style={{ backgroundColor: C.accent, borderRadius: 12, paddingHorizontal: 28, paddingVertical: 13 }}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Open Settings</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={requestPermission}
                  style={{ backgroundColor: C.accent, borderRadius: 12, paddingHorizontal: 28, paddingVertical: 13 }}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Allow Camera</Text>
                </TouchableOpacity>
              )}
            </View>
          )
        ) : (
          /* Preview — this entire View is captured */
          <View ref={previewRef} collapsable={false} style={StyleSheet.absoluteFill}>
            <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            {statsPanel(true)}
          </View>
        )}

        {/* Close button — always on top */}
        <TouchableOpacity onPress={onClose} style={{ position: 'absolute', top: insets.top + 8, left: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="close" size={20} color="#fff" />
        </TouchableOpacity>

        {/* Preview actions */}
        {phase === 'preview' && (
          <View style={{ position: 'absolute', top: insets.top + 8, right: 16, flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity onPress={() => { setPhase('camera'); setPhotoUri(null); }} style={{ backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9 }}>
              <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={doShare} disabled={sharing} style={{ backgroundColor: C.accent, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="share-social" size={14} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{sharing ? 'Sharing…' : 'Share'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ── CARDIO LOG MODAL ─────────────────────────────────────
const CARDIO_ACTIVITIES = [
  { label: 'Running',       icon: 'fitness-outline'      },
  { label: 'Treadmill',     icon: 'fitness-outline'      },
  { label: 'Cycling',       icon: 'bicycle-outline'      },
  { label: 'Rowing',        icon: 'boat-outline'         },
  { label: 'HIIT',          icon: 'flash-outline'        },
  { label: 'Jump Rope',     icon: 'git-compare-outline'  },
  { label: 'Elliptical',    icon: 'sync-outline'         },
  { label: 'Swimming',      icon: 'water-outline'        },
  { label: 'Stair Climber', icon: 'trending-up-outline'  },
  { label: 'Walking',       icon: 'walk-outline'         },
];

function CardioLogModal({ visible, onClose, onSave, weightUnit = 'kg' }) {
  const C = useContext(ThemeContext);
  const insets = useSafeAreaInsets();
  const distUnit  = weightUnit === 'lbs' ? 'mi' : 'km';
  const speedUnit = weightUnit === 'lbs' ? 'mph' : 'km/h';

  const [activity, setActivity] = useState('Running');
  const [mins,     setMins]     = useState('');
  const [secs,     setSecs]     = useState('');
  const [distance, setDistance] = useState('');
  const [speed,    setSpeed]    = useState('');
  const [incline,  setIncline]  = useState('');
  const [calories, setCalories] = useState('');

  const isTreadmill = activity === 'Treadmill';
  const hasDist = ['Running','Treadmill','Cycling','Rowing','Swimming','Walking'].includes(activity);

  const reset = () => {
    setActivity('Running'); setMins(''); setSecs('');
    setDistance(''); setSpeed(''); setIncline(''); setCalories('');
  };

  const handleSave = async () => {
    const totalSecs = (parseInt(mins) || 0) * 60 + (parseInt(secs) || 0);
    if (totalSecs === 0) {
      Alert.alert('Add Duration', 'Enter at least a duration for this session.');
      return;
    }
    const session = {
      id: `${Date.now()}`,
      type: 'cardio',
      name: activity,
      activity,
      date: new Date().toISOString(),
      duration: totalSecs,
      distance: parseFloat(distance) || 0,
      speed:    parseFloat(speed)    || 0,
      incline:  parseFloat(incline)  || 0,
      calories: parseInt(calories)   || 0,
      volume: 0,
      exercises: [],
    };
    const raw = await AsyncStorage.getItem(WORKOUTS_KEY);
    const updated = [session, ...parseStoredJson(raw, [])].slice(0, 100);
    await AsyncStorage.setItem(WORKOUTS_KEY, JSON.stringify(updated));
    onSave(session);
    reset();
  };

  const Field = ({ label, value, onChange, placeholder, unit, show = true }) => {
    if (!show) return null;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: C.border }}>
        <Text style={{ fontSize: 15, color: C.t1 }}>{label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TextInput
            style={{ fontSize: 16, fontWeight: '700', color: C.accent, textAlign: 'right', minWidth: 72 }}
            value={value}
            onChangeText={onChange}
            keyboardType="decimal-pad"
            placeholder={placeholder}
            placeholderTextColor={C.t3}
          />
          <Text style={{ fontSize: 13, color: C.t3, width: 40 }}>{unit}</Text>
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 20, paddingTop: insets.top + 16, paddingBottom: 16,
          borderBottomWidth: 0.5, borderBottomColor: C.border }}>
          <TouchableOpacity onPress={() => { reset(); onClose(); }}>
            <Text style={{ fontSize: 16, color: C.accent }}>Cancel</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: '700', color: C.t1 }}>Log Cardio</Text>
          <TouchableOpacity onPress={handleSave}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: C.accent }}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
          {/* Activity picker */}
          <Text style={{ fontSize: 12, fontWeight: '700', color: C.t3, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>Activity</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 28 }}>
            {CARDIO_ACTIVITIES.map(a => {
              const active = activity === a.label;
              return (
                <TouchableOpacity key={a.label} onPress={() => setActivity(a.label)} activeOpacity={0.75}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9,
                    borderRadius: 20, backgroundColor: active ? C.accent : C.surface,
                    borderWidth: 1, borderColor: active ? C.accent : C.border }}>
                  <Ionicons name={a.icon} size={14} color={active ? '#fff' : C.t2} />
                  <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : C.t1 }}>{a.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Duration */}
          <Text style={{ fontSize: 12, fontWeight: '700', color: C.t3, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>Duration</Text>
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 28 }}>
            {[
              { label: 'MIN', value: mins, onChange: setMins, maxLength: 3 },
              { label: 'SEC', value: secs, onChange: setSecs, maxLength: 2 },
            ].map(f => (
              <View key={f.label} style={{ flex: 1, backgroundColor: C.surface, borderRadius: 14, padding: 18, alignItems: 'center' }}>
                <TextInput
                  style={{ fontSize: 32, fontWeight: '800', color: C.t1, textAlign: 'center', minWidth: 60 }}
                  value={f.value}
                  onChangeText={f.onChange}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={C.t3}
                  maxLength={f.maxLength}
                />
                <Text style={{ fontSize: 11, fontWeight: '700', color: C.t3, marginTop: 6, letterSpacing: 1 }}>{f.label}</Text>
              </View>
            ))}
          </View>

          {/* Metrics */}
          <Text style={{ fontSize: 12, fontWeight: '700', color: C.t3, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>Metrics</Text>
          <View style={{ backgroundColor: C.surface, borderRadius: 14, overflow: 'hidden', marginBottom: 28 }}>
            <Field label="Distance"       value={distance} onChange={setDistance} placeholder="0.0"  unit={distUnit}  show={hasDist} />
            <Field label="Avg Speed"      value={speed}    onChange={setSpeed}    placeholder="0.0"  unit={speedUnit} />
            <Field label="Incline"        value={incline}  onChange={setIncline}  placeholder="0.0"  unit="%"         show={isTreadmill} />
            <Field label="Calories Burned" value={calories} onChange={setCalories} placeholder="0"   unit="kcal" />
          </View>

          <TouchableOpacity style={{ backgroundColor: C.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}
            onPress={handleSave} activeOpacity={0.85}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>Save Session</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

function NutritionShareModal({ onClose, meal }) {
  const insets     = useSafeAreaInsets();
  const cameraRef  = useRef(null);
  const previewRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [phase,    setPhase]   = useState('camera');
  const [photoUri, setPhotoUri] = useState(null);
  const [sharing,  setSharing]  = useState(false);
  const [facing,   setFacing]   = useState('back');

  useEffect(() => {
    setPhase('camera'); setPhotoUri(null); setSharing(false);
  }, []);

  const mealP   = meal.items.reduce((s, i) => s + (i.p   || 0), 0);
  const mealC   = meal.items.reduce((s, i) => s + (i.c   || 0), 0);
  const mealF   = meal.items.reduce((s, i) => s + (i.f   || 0), 0);
  const mealCal = meal.items.reduce((s, i) => s + (i.cal || 0), 0);
  const macroCal = mealP * 4 + mealC * 4 + mealF * 9;
  const CTRL_H   = 110 + insets.bottom;

  const takePicture = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 1.0 });
      setPhotoUri(photo.uri);
      setPhase('preview');
    } catch { Alert.alert('Error', 'Could not take photo.'); }
  };

  const doShare = async () => {
    try {
      setSharing(true);
      const uri = await captureRef(previewRef, { format: 'jpg', quality: 0.95, pixelRatio: PixelRatio.get() });
      await Sharing.shareAsync(uri, { mimeType: 'image/jpeg' });
    } catch (e) { Alert.alert('Could not share', e.message); }
    finally { setSharing(false); }
  };

  const sh = {};

  const statsPanel = (forCapture) => (
    <View style={{
      position: 'absolute', left: 0, right: 0,
      top: 0, bottom: 0,
      alignItems: 'center', justifyContent: 'flex-end',
      paddingBottom: forCapture ? insets.bottom + 115 : CTRL_H + 115,
    }}>
      {/* Dark radial scrim */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 440 }} pointerEvents="none">
        <Svg width="100%" height="440" style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="nsmScrim" cx="50%" cy="68%" rx="70%" ry="52%" gradientUnits="objectBoundingBox">
              <Stop offset="0%"   stopColor="#000000" stopOpacity="0.72" />
              <Stop offset="60%"  stopColor="#000000" stopOpacity="0.30" />
              <Stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="440" fill="url(#nsmScrim)" />
        </Svg>
      </View>

      <View style={{ alignItems: 'center' }}>
        {/* Meal name title */}
        <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.3,
          textAlign: 'center', paddingHorizontal: 28 }} numberOfLines={1}>
          {meal.name}
        </Text>

        {/* Accent divider */}
        <View style={{ width: 28, height: 2, backgroundColor: '#0A84FF', borderRadius: 2, marginTop: 8, marginBottom: 14 }} />

        {/* Macro rings */}
        <View style={{ flexDirection: 'row', gap: 18, marginBottom: 14 }}>
          {[
            { name: 'Protein', val: Math.round(mealP), color: '#FFB340', pct: macroCal > 0 ? (mealP * 4) / macroCal : 0 },
            { name: 'Carbs',   val: Math.round(mealC), color: '#30D158', pct: macroCal > 0 ? (mealC * 4) / macroCal : 0 },
            { name: 'Fat',     val: Math.round(mealF), color: '#BF5AF2', pct: macroCal > 0 ? (mealF * 9) / macroCal : 0 },
          ].map(m => (
            <View key={m.name} style={{ alignItems: 'center', gap: 5 }}>
              <View style={{ width: 72, height: 72, alignItems: 'center', justifyContent: 'center' }}>
                <RingProgress size={72} stroke={7} progress={m.pct} color={m.color} trackColor="rgba(255,255,255,0.07)" />
                <View style={{ position: 'absolute', alignItems: 'center' }}>
                  <Text style={{ color: m.color, fontSize: 14, fontWeight: '800' }}>{m.val}g</Text>
                </View>
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: '700',
                letterSpacing: 1.2, textAlign: 'center' }}>
                {m.name.toUpperCase()}
              </Text>
            </View>
          ))}
        </View>

        {/* Calories */}
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: -0.2, textAlign: 'center' }}>
          {mealCal} kcal
        </Text>

        {/* Watermark */}
        <Text style={{ color: '#0A84FF', fontSize: 11, fontWeight: '800', letterSpacing: 2.5, marginTop: 12, textAlign: 'center' }}>
          BARBELLZ
        </Text>
      </View>
    </View>
  );

  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {phase === 'camera' ? (
          permission?.granted ? (
            <>
              <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} />
              {statsPanel(false)}
              <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: CTRL_H, backgroundColor: '#000', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 56, paddingBottom: insets.bottom }}>
                <TouchableOpacity onPress={() => setFacing(f => f === 'front' ? 'back' : 'front')} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="camera-reverse" size={22} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={takePicture} activeOpacity={0.85} style={{ width: 76, height: 76, borderRadius: 38, borderWidth: 3, borderColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff' }} />
                </TouchableOpacity>
                <View style={{ width: 44 }} />
              </View>
            </>
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
              <Ionicons name="camera-outline" size={48} color="rgba(255,255,255,0.4)" style={{ marginBottom: 16 }} />
              <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 8 }}>Camera Access Needed</Text>
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
                {permission?.canAskAgain === false ? 'Open Settings to enable camera access for Barbellz.' : 'Allow camera access to share your meal stats.'}
              </Text>
              <TouchableOpacity onPress={permission?.canAskAgain === false ? () => Linking.openSettings() : requestPermission} style={{ backgroundColor: '#0A84FF', borderRadius: 12, paddingHorizontal: 28, paddingVertical: 13 }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>{permission?.canAskAgain === false ? 'Open Settings' : 'Allow Camera'}</Text>
              </TouchableOpacity>
            </View>
          )
        ) : (
          <View ref={previewRef} collapsable={false} style={StyleSheet.absoluteFill}>
            <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            {statsPanel(true)}
          </View>
        )}
        <TouchableOpacity onPress={onClose} style={{ position: 'absolute', top: insets.top + 8, left: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="close" size={20} color="#fff" />
        </TouchableOpacity>
        {phase === 'preview' && (
          <View style={{ position: 'absolute', top: insets.top + 8, right: 16, flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity onPress={() => { setPhase('camera'); setPhotoUri(null); }} style={{ backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9 }}>
              <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={doShare} disabled={sharing} style={{ backgroundColor: '#0A84FF', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="share-social" size={14} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{sharing ? 'Sharing…' : 'Share'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const TAB_META = {
  Home:      { label: 'Home',      icon: 'home-outline',        activeIcon: 'home'        },
  Nutrition: { label: 'Nutrition', icon: 'restaurant-outline',  activeIcon: 'restaurant'  },
  Workout:   { label: 'Workout',   icon: 'barbell-outline',     activeIcon: 'barbell'     },
  Progress:  { label: 'Progress',  icon: 'stats-chart-outline', activeIcon: 'stats-chart' },
  Profile:   { label: 'Profile',   icon: 'person-outline',      activeIcon: 'person'      },
};

function FloatingTabBar({ state, descriptors, navigation }) {
  const insets  = useSafeAreaInsets();
  const C       = useContext(ThemeContext);
  const { width: screenW } = Dimensions.get('window');
  const tabW    = screenW / state.routes.length;
  const PILL_W  = 44;

  const slideX  = useRef(new Animated.Value(state.index * tabW)).current;
  const scales  = useRef(state.routes.map((_, i) => new Animated.Value(i === state.index ? 1 : 0.8))).current;

  useEffect(() => {
    Animated.spring(slideX, { toValue: state.index * tabW, damping: 18, stiffness: 280, useNativeDriver: true }).start();
    scales.forEach((s, i) =>
      Animated.spring(s, { toValue: i === state.index ? 1 : 0.8, damping: 14, stiffness: 260, useNativeDriver: true }).start()
    );
  }, [state.index]);

  return (
    <View style={{ backgroundColor: C.bg, borderTopWidth: 0.5, borderTopColor: C.border, paddingBottom: insets.bottom }}>
      <Animated.View style={{
        position: 'absolute',
        top: 6,
        left: (tabW - PILL_W) / 2,
        width: PILL_W,
        height: 30,
        borderRadius: 15,
        backgroundColor: C.accent + '20',
        transform: [{ translateX: slideX }],
      }} />
      <View style={{ flexDirection: 'row' }}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const meta    = TAB_META[route.name] || { label: route.name, icon: 'ellipse-outline', activeIcon: 'ellipse' };
          const { options } = descriptors[route.key];

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };

          return (
            <TouchableOpacity
              key={route.key}
              onPress={onPress}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              style={{ flex: 1, alignItems: 'center', paddingTop: 10, paddingBottom: 8 }}
            >
              <Animated.View style={{ transform: [{ scale: scales[index] }] }}>
                <Ionicons
                  name={focused ? meta.activeIcon : meta.icon}
                  size={24}
                  color={focused ? C.accent : C.t3}
                />
              </Animated.View>
              <Text style={{
                fontSize: 10,
                marginTop: 3,
                color: focused ? C.accent : C.t3,
                fontWeight: focused ? '700' : '400',
                letterSpacing: 0.1,
              }}>
                {meta.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}



const EXERCISE_DB = [
  { id:'ex01', name:'Bench Press',                   muscle:'Chest',     equipment:'Barbell'    },
  { id:'ex02', name:'Incline Bench Press',            muscle:'Chest',     equipment:'Barbell'    },
  { id:'ex03', name:'Decline Bench Press',            muscle:'Chest',     equipment:'Barbell'    },
  { id:'ex04', name:'Dumbbell Bench Press',           muscle:'Chest',     equipment:'Dumbbell'   },
  { id:'ex05', name:'Incline Dumbbell Press',         muscle:'Chest',     equipment:'Dumbbell'   },
  { id:'ex06', name:'Dumbbell Fly',                   muscle:'Chest',     equipment:'Dumbbell'   },
  { id:'ex07', name:'Cable Fly',                      muscle:'Chest',     equipment:'Cable'      },
  { id:'ex08', name:'Push-Up',                        muscle:'Chest',     equipment:'Bodyweight' },
  { id:'ex09', name:'Chest Dip',                      muscle:'Chest',     equipment:'Bodyweight' },
  { id:'ex63', name:'Machine Chest Press',            muscle:'Chest',     equipment:'Machine'    },
  { id:'ex64', name:'Pec Deck',                       muscle:'Chest',     equipment:'Machine'    },
  { id:'ex65', name:'Landmine Press',                 muscle:'Chest',     equipment:'Barbell'    },
  { id:'ex66', name:'Wide Push-Up',                   muscle:'Chest',     equipment:'Bodyweight' },
  { id:'ex10', name:'Deadlift',                       muscle:'Back',      equipment:'Barbell'    },
  { id:'ex11', name:'Pull-Up',                        muscle:'Back',      equipment:'Bodyweight' },
  { id:'ex12', name:'Chin-Up',                        muscle:'Back',      equipment:'Bodyweight' },
  { id:'ex13', name:'Lat Pulldown',                   muscle:'Back',      equipment:'Cable'      },
  { id:'ex14', name:'Seated Cable Row',               muscle:'Back',      equipment:'Cable'      },
  { id:'ex15', name:'Bent-Over Row',                  muscle:'Back',      equipment:'Barbell'    },
  { id:'ex16', name:'Dumbbell Row',                   muscle:'Back',      equipment:'Dumbbell'   },
  { id:'ex17', name:'T-Bar Row',                      muscle:'Back',      equipment:'Machine'    },
  { id:'ex18', name:'Face Pull',                      muscle:'Back',      equipment:'Cable'      },
  { id:'ex19', name:'Straight-Arm Pulldown',          muscle:'Back',      equipment:'Cable'      },
  { id:'ex67', name:'Rack Pull',                      muscle:'Back',      equipment:'Barbell'    },
  { id:'ex68', name:'Chest-Supported Row',            muscle:'Back',      equipment:'Dumbbell'   },
  { id:'ex69', name:'Inverted Row',                   muscle:'Back',      equipment:'Bodyweight' },
  { id:'ex70', name:'Meadows Row',                    muscle:'Back',      equipment:'Barbell'    },
  { id:'ex71', name:'Single-Arm Lat Pulldown',        muscle:'Back',      equipment:'Cable'      },
  { id:'ex72', name:'Good Morning',                   muscle:'Back',      equipment:'Barbell'    },
  { id:'ex20', name:'Overhead Press',                 muscle:'Shoulders', equipment:'Barbell'    },
  { id:'ex21', name:'Dumbbell Shoulder Press',        muscle:'Shoulders', equipment:'Dumbbell'   },
  { id:'ex22', name:'Lateral Raise',                  muscle:'Shoulders', equipment:'Dumbbell'   },
  { id:'ex23', name:'Front Raise',                    muscle:'Shoulders', equipment:'Dumbbell'   },
  { id:'ex24', name:'Reverse Fly',                    muscle:'Shoulders', equipment:'Dumbbell'   },
  { id:'ex25', name:'Arnold Press',                   muscle:'Shoulders', equipment:'Dumbbell'   },
  { id:'ex26', name:'Upright Row',                    muscle:'Shoulders', equipment:'Barbell'    },
  { id:'ex27', name:'Cable Lateral Raise',            muscle:'Shoulders', equipment:'Cable'      },
  { id:'ex73', name:'Machine Shoulder Press',         muscle:'Shoulders', equipment:'Machine'    },
  { id:'ex74', name:'Machine Lateral Raise',          muscle:'Shoulders', equipment:'Machine'    },
  { id:'ex75', name:'Barbell Front Raise',            muscle:'Shoulders', equipment:'Barbell'    },
  { id:'ex76', name:'Cable Face Pull',                muscle:'Shoulders', equipment:'Cable'      },
  { id:'ex28', name:'Barbell Curl',                   muscle:'Biceps',    equipment:'Barbell'    },
  { id:'ex29', name:'Dumbbell Curl',                  muscle:'Biceps',    equipment:'Dumbbell'   },
  { id:'ex30', name:'Hammer Curl',                    muscle:'Biceps',    equipment:'Dumbbell'   },
  { id:'ex31', name:'Preacher Curl',                  muscle:'Biceps',    equipment:'Barbell'    },
  { id:'ex32', name:'Cable Curl',                     muscle:'Biceps',    equipment:'Cable'      },
  { id:'ex33', name:'Concentration Curl',             muscle:'Biceps',    equipment:'Dumbbell'   },
  { id:'ex77', name:'Incline Dumbbell Curl',          muscle:'Biceps',    equipment:'Dumbbell'   },
  { id:'ex78', name:'Spider Curl',                    muscle:'Biceps',    equipment:'Dumbbell'   },
  { id:'ex79', name:'Reverse Curl',                   muscle:'Biceps',    equipment:'Barbell'    },
  { id:'ex80', name:'Cross-Body Hammer Curl',         muscle:'Biceps',    equipment:'Dumbbell'   },
  { id:'ex34', name:'Tricep Pushdown',                muscle:'Triceps',   equipment:'Cable'      },
  { id:'ex35', name:'Skull Crusher',                  muscle:'Triceps',   equipment:'Barbell'    },
  { id:'ex36', name:'Close-Grip Bench Press',         muscle:'Triceps',   equipment:'Barbell'    },
  { id:'ex37', name:'Tricep Dip',                     muscle:'Triceps',   equipment:'Bodyweight' },
  { id:'ex38', name:'Overhead Tricep Extension',      muscle:'Triceps',   equipment:'Dumbbell'   },
  { id:'ex39', name:'Cable Overhead Extension',       muscle:'Triceps',   equipment:'Cable'      },
  { id:'ex40', name:'Diamond Push-Up',                muscle:'Triceps',   equipment:'Bodyweight' },
  { id:'ex81', name:'Tricep Kickback',                muscle:'Triceps',   equipment:'Dumbbell'   },
  { id:'ex82', name:'Rope Pushdown',                  muscle:'Triceps',   equipment:'Cable'      },
  { id:'ex41', name:'Squat',                          muscle:'Legs',      equipment:'Barbell'    },
  { id:'ex42', name:'Romanian Deadlift',              muscle:'Legs',      equipment:'Barbell'    },
  { id:'ex43', name:'Leg Press',                      muscle:'Legs',      equipment:'Machine'    },
  { id:'ex44', name:'Leg Curl',                       muscle:'Legs',      equipment:'Machine'    },
  { id:'ex45', name:'Leg Extension',                  muscle:'Legs',      equipment:'Machine'    },
  { id:'ex46', name:'Calf Raise',                     muscle:'Legs',      equipment:'Machine'    },
  { id:'ex47', name:'Hack Squat',                     muscle:'Legs',      equipment:'Machine'    },
  { id:'ex48', name:'Bulgarian Split Squat',          muscle:'Legs',      equipment:'Dumbbell'   },
  { id:'ex49', name:'Walking Lunges',                 muscle:'Legs',      equipment:'Dumbbell'   },
  { id:'ex50', name:'Goblet Squat',                   muscle:'Legs',      equipment:'Dumbbell'   },
  { id:'ex83', name:'Front Squat',                    muscle:'Legs',      equipment:'Barbell'    },
  { id:'ex84', name:'Box Squat',                      muscle:'Legs',      equipment:'Barbell'    },
  { id:'ex85', name:'Smith Machine Squat',            muscle:'Legs',      equipment:'Machine'    },
  { id:'ex86', name:'Seated Leg Curl',                muscle:'Legs',      equipment:'Machine'    },
  { id:'ex87', name:'Standing Calf Raise',            muscle:'Legs',      equipment:'Barbell'    },
  { id:'ex88', name:'Seated Calf Raise',              muscle:'Legs',      equipment:'Machine'    },
  { id:'ex89', name:'Nordic Hamstring Curl',          muscle:'Legs',      equipment:'Bodyweight' },
  { id:'ex90', name:'Box Jump',                       muscle:'Legs',      equipment:'Bodyweight' },
  { id:'ex51', name:'Hip Thrust',                     muscle:'Glutes',    equipment:'Barbell'    },
  { id:'ex52', name:'Glute Bridge',                   muscle:'Glutes',    equipment:'Bodyweight' },
  { id:'ex53', name:'Cable Kickback',                 muscle:'Glutes',    equipment:'Cable'      },
  { id:'ex54', name:'Sumo Deadlift',                  muscle:'Glutes',    equipment:'Barbell'    },
  { id:'ex55', name:'Step-Up',                        muscle:'Glutes',    equipment:'Dumbbell'   },
  { id:'ex91', name:'Donkey Kick',                    muscle:'Glutes',    equipment:'Bodyweight' },
  { id:'ex92', name:'Fire Hydrant',                   muscle:'Glutes',    equipment:'Bodyweight' },
  { id:'ex93', name:'Sumo Squat',                     muscle:'Glutes',    equipment:'Barbell'    },
  { id:'ex56', name:'Plank',                          muscle:'Core',      equipment:'Bodyweight' },
  { id:'ex57', name:'Crunch',                         muscle:'Core',      equipment:'Bodyweight' },
  { id:'ex58', name:'Russian Twist',                  muscle:'Core',      equipment:'Bodyweight' },
  { id:'ex59', name:'Hanging Leg Raise',              muscle:'Core',      equipment:'Bodyweight' },
  { id:'ex60', name:'Cable Crunch',                   muscle:'Core',      equipment:'Cable'      },
  { id:'ex61', name:'Ab Wheel Rollout',               muscle:'Core',      equipment:'Bodyweight' },
  { id:'ex62', name:'Side Plank',                     muscle:'Core',      equipment:'Bodyweight' },
  { id:'ex94', name:'Bicycle Crunch',                 muscle:'Core',      equipment:'Bodyweight' },
  { id:'ex95', name:'Dead Bug',                       muscle:'Core',      equipment:'Bodyweight' },
  { id:'ex96', name:'Pallof Press',                   muscle:'Core',      equipment:'Cable'      },
  { id:'ex97', name:'V-Up',                           muscle:'Core',      equipment:'Bodyweight' },
  { id:'ex98', name:'Hollow Body Hold',               muscle:'Core',      equipment:'Bodyweight' },
  { id:'ex99',  name:'Incline Machine Chest Press',    muscle:'Chest',     equipment:'Machine'    },
  { id:'ex100', name:'Decline Machine Chest Press',    muscle:'Chest',     equipment:'Machine'    },
  { id:'ex101', name:'Smith Machine Bench Press',      muscle:'Chest',     equipment:'Machine'    },
  { id:'ex102', name:'Smith Machine Incline Press',    muscle:'Chest',     equipment:'Machine'    },
  { id:'ex103', name:'Low Cable Fly',                  muscle:'Chest',     equipment:'Cable'      },
  { id:'ex104', name:'High Cable Fly',                 muscle:'Chest',     equipment:'Cable'      },
  { id:'ex105', name:'Single-Arm Cable Fly',           muscle:'Chest',     equipment:'Cable'      },
  { id:'ex106', name:'Svend Press',                    muscle:'Chest',     equipment:'Other'      },
  { id:'ex107', name:'Assisted Pull-Up',               muscle:'Back',      equipment:'Machine'    },
  { id:'ex108', name:'Neutral-Grip Pull-Up',           muscle:'Back',      equipment:'Bodyweight' },
  { id:'ex109', name:'Wide-Grip Lat Pulldown',         muscle:'Back',      equipment:'Cable'      },
  { id:'ex110', name:'Close-Grip Lat Pulldown',        muscle:'Back',      equipment:'Cable'      },
  { id:'ex111', name:'Machine Row',                    muscle:'Back',      equipment:'Machine'    },
  { id:'ex112', name:'Single-Arm Cable Row',           muscle:'Back',      equipment:'Cable'      },
  { id:'ex113', name:'Seal Row',                       muscle:'Back',      equipment:'Barbell'    },
  { id:'ex114', name:'Dumbbell Pullover',              muscle:'Back',      equipment:'Dumbbell'   },
  { id:'ex115', name:'Shrug',                          muscle:'Back',      equipment:'Dumbbell'   },
  { id:'ex116', name:'Cable Y-Raise',                  muscle:'Shoulders', equipment:'Cable'      },
  { id:'ex117', name:'Dumbbell Rear Delt Row',         muscle:'Shoulders', equipment:'Dumbbell'   },
  { id:'ex118', name:'Reverse Pec Deck',               muscle:'Shoulders', equipment:'Machine'    },
  { id:'ex119', name:'Plate Front Raise',              muscle:'Shoulders', equipment:'Other'      },
  { id:'ex120', name:'Lean-Away Cable Lateral Raise',  muscle:'Shoulders', equipment:'Cable'      },
  { id:'ex121', name:'Z Press',                        muscle:'Shoulders', equipment:'Barbell'    },
  { id:'ex122', name:'EZ-Bar Curl',                    muscle:'Biceps',    equipment:'Barbell'    },
  { id:'ex123', name:'Machine Preacher Curl',          muscle:'Biceps',    equipment:'Machine'    },
  { id:'ex124', name:'Bayesian Cable Curl',            muscle:'Biceps',    equipment:'Cable'      },
  { id:'ex125', name:'High Cable Curl',                muscle:'Biceps',    equipment:'Cable'      },
  { id:'ex126', name:'Zottman Curl',                   muscle:'Biceps',    equipment:'Dumbbell'   },
  { id:'ex127', name:'Machine Tricep Extension',       muscle:'Triceps',   equipment:'Machine'    },
  { id:'ex128', name:'Single-Arm Cable Pushdown',      muscle:'Triceps',   equipment:'Cable'      },
  { id:'ex129', name:'Cable Tricep Kickback',          muscle:'Triceps',   equipment:'Cable'      },
  { id:'ex130', name:'EZ-Bar Overhead Extension',      muscle:'Triceps',   equipment:'Barbell'    },
  { id:'ex131', name:'Assisted Tricep Dip',            muscle:'Triceps',   equipment:'Machine'    },
  { id:'ex132', name:'Lying Leg Curl',                 muscle:'Legs',      equipment:'Machine'    },
  { id:'ex133', name:'Single-Leg Leg Press',           muscle:'Legs',      equipment:'Machine'    },
  { id:'ex134', name:'Pendulum Squat',                 muscle:'Legs',      equipment:'Machine'    },
  { id:'ex135', name:'Belt Squat',                     muscle:'Legs',      equipment:'Machine'    },
  { id:'ex136', name:'Reverse Lunge',                  muscle:'Legs',      equipment:'Dumbbell'   },
  { id:'ex137', name:'Walking Lunge',                  muscle:'Legs',      equipment:'Bodyweight' },
  { id:'ex138', name:'Sissy Squat',                    muscle:'Legs',      equipment:'Bodyweight' },
  { id:'ex139', name:'Tibialis Raise',                 muscle:'Legs',      equipment:'Bodyweight' },
  { id:'ex140', name:'Cable Pull-Through',             muscle:'Glutes',    equipment:'Cable'      },
  { id:'ex141', name:'Machine Hip Abduction',          muscle:'Glutes',    equipment:'Machine'    },
  { id:'ex142', name:'Machine Hip Adduction',          muscle:'Glutes',    equipment:'Machine'    },
  { id:'ex143', name:'Single-Leg Hip Thrust',          muscle:'Glutes',    equipment:'Bodyweight' },
  { id:'ex144', name:'B-Stance Hip Thrust',            muscle:'Glutes',    equipment:'Barbell'    },
  { id:'ex145', name:'Reverse Hyperextension',         muscle:'Glutes',    equipment:'Machine'    },
  { id:'ex146', name:'Decline Sit-Up',                 muscle:'Core',      equipment:'Bodyweight' },
  { id:'ex147', name:'Reverse Crunch',                 muscle:'Core',      equipment:'Bodyweight' },
  { id:'ex148', name:"Captain's Chair Knee Raise",     muscle:'Core',      equipment:'Machine'    },
  { id:'ex149', name:'Cable Woodchop',                 muscle:'Core',      equipment:'Cable'      },
  { id:'ex150', name:"Farmer's Carry",                 muscle:'Core',      equipment:'Dumbbell'   },
  { id:'ex151', name:'Suitcase Carry',                 muscle:'Core',      equipment:'Dumbbell'   },
  { id:'ex152', name:'Kettlebell Swing',               muscle:'Glutes',    equipment:'Kettlebell' },
  { id:'ex153', name:'Turkish Get-Up',                 muscle:'Core',      equipment:'Kettlebell' },
];

const fmtDuration = (secs) => {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const fmtWkDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso), diff = Math.floor((Date.now() - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day:'numeric', month:'short' });
};
const newSet = () => ({ id: `${Date.now()}${Math.random()}`, weight:'', reps:'', rpe:'', completed:false });

const PLATES_KG_FULL  = [25, 20, 15, 10, 5, 2.5, 1.25];
const PLATES_KG_NO25  = [20, 15, 10, 5, 2.5, 1.25];
const PLATES_LBS_FULL = [45, 35, 25, 10, 5, 2.5];
const PLATES_LBS_NO45 = [35, 25, 10, 5, 2.5];
const PLATE_COLORS_KG  = { 25:'#E74C3C', 20:'#2980B9', 15:'#F39C12', 10:'#27AE60', 5:'#8E8E93', 2.5:'#AEAEB2', 1.25:'#C7C7CC' };
const PLATE_COLORS_LBS = { 45:'#E74C3C', 35:'#2980B9', 25:'#F39C12', 10:'#27AE60', 5:'#8E8E93', 2.5:'#AEAEB2' };
const PLATE_H_KG  = { 25:72, 20:64, 15:56, 10:50, 5:44, 2.5:38, 1.25:34 };
const PLATE_H_LBS = { 45:72, 35:64, 25:56, 10:50, 5:44, 2.5:38 };

function calcPlates(target, bar, plateSet) {
  if (target <= bar) return [];
  let rem = Math.round((target - bar) / 2 * 1000) / 1000;
  const result = [];
  for (const p of plateSet) {
    const n = Math.floor(rem / p + 0.001);
    if (n > 0) { result.push({ weight: p, count: n }); rem = Math.round((rem - p * n) * 1000) / 1000; }
  }
  return result;
}

function PlateCalculatorModal({ visible, onClose }) {
  const C = useContext(ThemeContext);
  const insets = useSafeAreaInsets();
  const [targetStr,     setTargetStr]     = useState('');
  const [unit,          setUnit]          = useState('kg');
  const [hasLargePlate, setHasLargePlate] = useState(true);
  const [barKg,         setBarKg]         = useState(20);
  const [barLbs,        setBarLbs]        = useState(45);

  const isKg        = unit === 'kg';
  const plateSet    = isKg ? (hasLargePlate ? PLATES_KG_FULL : PLATES_KG_NO25) : (hasLargePlate ? PLATES_LBS_FULL : PLATES_LBS_NO45);
  const plateColors = isKg ? PLATE_COLORS_KG  : PLATE_COLORS_LBS;
  const plateH      = isKg ? PLATE_H_KG       : PLATE_H_LBS;
  const barWeight   = isKg ? barKg : barLbs;
  const unitLabel   = isKg ? 'kg' : 'lbs';
  const barOptions  = isKg
    ? [{ w:20, lbl:"Men's (20)" }, { w:15, lbl:"Women's (15)" }, { w:10, lbl:'Youth (10)' }]
    : [{ w:45, lbl:"Men's (45)" }, { w:35, lbl:"Women's (35)" }];
  const quickWeights = isKg ? [40,60,80,100,120,140,160,180,200] : [95,135,185,225,275,315,365,405];

  const target = parseFloat(targetStr) || 0;
  const plates  = useMemo(() => calcPlates(target, barWeight, plateSet), [target, barWeight, plateSet]);
  const sideWt  = plates.reduce((s, p) => s + p.weight * p.count, 0);
  const total   = barWeight + sideWt * 2;
  const fmt = (n) => n % 1 ? n.toFixed(2) : String(n);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex:1, backgroundColor: C.bg }}>

        {/* Header */}
        <View style={{ paddingTop: insets.top + 18, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.border }}>
          <View>
            <Text style={{ fontSize: 11, fontWeight: '700', color: C.accent, letterSpacing: 2, marginBottom: 3 }}>TOOL</Text>
            <Text style={{ fontSize: 24, fontWeight: '800', color: C.t1, letterSpacing: -0.5 }}>Plate Calculator</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12}
            style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="close" size={17} color={C.t2} />
          </TouchableOpacity>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 48 }}>

          {/* Hero input */}
          <View style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: C.t3, letterSpacing: 1.5, marginBottom: 10 }}>TARGET WEIGHT</Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
              <TextInput
                style={{ flex: 1, color: C.t1, fontSize: 52, fontWeight: '800', letterSpacing: -2, padding: 0 }}
                value={targetStr} onChangeText={setTargetStr}
                keyboardType="decimal-pad"
                placeholder={isKg ? '100' : '225'}
                placeholderTextColor={C.t3}
              />
              {/* Unit toggle inline */}
              <View style={{ flexDirection: 'row', backgroundColor: C.surface, borderRadius: 10, padding: 3, marginBottom: 8 }}>
                {['kg','lbs'].map(u => (
                  <TouchableOpacity key={u} onPress={() => { setUnit(u); setTargetStr(''); }}
                    style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                      backgroundColor: unit === u ? C.accent : 'transparent' }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: unit === u ? '#fff' : C.t2 }}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            {/* Quick weights */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}
              contentContainerStyle={{ gap: 8 }}>
              {quickWeights.map(w => (
                <TouchableOpacity key={w} onPress={() => setTargetStr(String(w))}
                  style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                    backgroundColor: targetStr === String(w) ? C.accent : C.surface }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: targetStr === String(w) ? '#fff' : C.t2 }}>{w}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Settings row */}
          <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: C.border, gap: 16 }}>
            {/* Bar weight */}
            <View>
              <Text style={{ fontSize: 11, fontWeight: '700', color: C.t3, letterSpacing: 1.5, marginBottom: 10 }}>BAR WEIGHT</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {barOptions.map(b => (
                  <TouchableOpacity key={b.w} onPress={() => isKg ? setBarKg(b.w) : setBarLbs(b.w)}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center',
                      backgroundColor: barWeight === b.w ? C.accent + '20' : C.surface,
                      borderWidth: 1.5, borderColor: barWeight === b.w ? C.accent : 'transparent' }}>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: barWeight === b.w ? C.accent : C.t1 }}>{b.w} {unitLabel}</Text>
                    <Text style={{ fontSize: 10, color: barWeight === b.w ? C.accent + 'AA' : C.t3, marginTop: 2 }}>{b.lbl.split(' ')[0]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Largest plate */}
            <View>
              <Text style={{ fontSize: 11, fontWeight: '700', color: C.t3, letterSpacing: 1.5, marginBottom: 10 }}>LARGEST PLATE</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {[true, false].map(has => (
                  <TouchableOpacity key={String(has)} onPress={() => setHasLargePlate(has)}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center',
                      backgroundColor: hasLargePlate === has ? C.accent + '20' : C.surface,
                      borderWidth: 1.5, borderColor: hasLargePlate === has ? C.accent : 'transparent' }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: hasLargePlate === has ? C.accent : C.t1 }}>
                      {has ? (isKg ? '25 kg' : '45 lbs') : (isKg ? '20 kg' : '35 lbs')}
                    </Text>
                    <Text style={{ fontSize: 10, color: hasLargePlate === has ? C.accent + 'AA' : C.t3, marginTop: 2 }}>
                      {has ? 'Available' : 'Not available'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          {/* Error state */}
          {target > 0 && target <= barWeight && (
            <View style={{ margin: 20, backgroundColor: C.surface, borderRadius: 16, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: '#FF453A30' }}>
              <Ionicons name="warning-outline" size={24} color="#FF453A" style={{ marginBottom: 8 }} />
              <Text style={{ color: C.t2, fontSize: 14, textAlign: 'center' }}>Target must exceed bar weight ({barWeight} {unitLabel})</Text>
            </View>
          )}

          {/* Result */}
          {plates.length > 0 && (
            <View style={{ margin: 20, gap: 16 }}>

              {/* Barbell visual */}
              <View style={{ backgroundColor: C.surface, borderRadius: 20, padding: 20, alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {/* Left collar */}
                  <View style={{ width: 6, height: 22, backgroundColor: C.t3, borderRadius: 3 }} />
                  {/* Left plates */}
                  {[...plates].reverse().flatMap((p, i) =>
                    Array.from({ length: p.count }, (_, ci) => (
                      <View key={`l-${i}-${ci}`} style={{
                        width: 13, height: plateH[p.weight] || 44,
                        backgroundColor: plateColors[p.weight] || C.accent,
                        borderRadius: 3, marginHorizontal: 1.5,
                        shadowColor: plateColors[p.weight], shadowOpacity: 0.5, shadowRadius: 4,
                      }} />
                    ))
                  )}
                  {/* Bar */}
                  <View style={{ width: 36, height: 7, backgroundColor: C.t2, borderRadius: 4 }} />
                  {/* Right plates */}
                  {plates.flatMap((p, i) =>
                    Array.from({ length: p.count }, (_, ci) => (
                      <View key={`r-${i}-${ci}`} style={{
                        width: 13, height: plateH[p.weight] || 44,
                        backgroundColor: plateColors[p.weight] || C.accent,
                        borderRadius: 3, marginHorizontal: 1.5,
                        shadowColor: plateColors[p.weight], shadowOpacity: 0.5, shadowRadius: 4,
                      }} />
                    ))
                  )}
                  {/* Right collar */}
                  <View style={{ width: 6, height: 22, backgroundColor: C.t3, borderRadius: 3 }} />
                </View>
                {/* Total weight under barbell */}
                <Text style={{ fontSize: 28, fontWeight: '900', color: C.t1, letterSpacing: -1, marginTop: 16 }}>
                  {fmt(total)} <Text style={{ fontSize: 16, fontWeight: '600', color: C.t3 }}>{unitLabel}</Text>
                </Text>
                {total !== target && (
                  <Text style={{ color: '#FF9F0A', fontSize: 12, fontWeight: '600', marginTop: 4 }}>
                    Closest to {target} {unitLabel}
                  </Text>
                )}
              </View>

              {/* Per-side breakdown */}
              <View style={{ backgroundColor: C.surface, borderRadius: 20, overflow: 'hidden' }}>
                <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: C.t3, letterSpacing: 1.5 }}>EACH SIDE</Text>
                </View>
                {plates.map((p, idx) => (
                  <View key={p.weight} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 13,
                    borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: C.border }}>
                    <View style={{ width: 10, height: 32, borderRadius: 3, backgroundColor: plateColors[p.weight] || C.accent, marginRight: 14 }} />
                    <Text style={{ fontSize: 16, fontWeight: '700', color: C.t1, flex: 1 }}>{p.weight} {unitLabel}</Text>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: C.accent, marginRight: 16 }}>× {p.count}</Text>
                    <Text style={{ fontSize: 13, fontWeight: '500', color: C.t2, width: 56, textAlign: 'right' }}>{fmt(p.weight * p.count)}</Text>
                  </View>
                ))}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                  paddingHorizontal: 18, paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.border,
                  backgroundColor: C.accent + '10' }}>
                  <Text style={{ color: C.t3, fontSize: 12, fontWeight: '500' }}>Bar {barWeight} + plates {fmt(sideWt * 2)} {unitLabel}</Text>
                  <Text style={{ fontSize: 18, fontWeight: '900', color: C.t1 }}>{fmt(total)} {unitLabel}</Text>
                </View>
              </View>
            </View>
          )}

          {/* Empty state */}
          {target === 0 && (
            <View style={{ alignItems: 'center', paddingTop: 40, paddingHorizontal: 40 }}>
              <Ionicons name="barbell-outline" size={48} color={C.t3} style={{ marginBottom: 12 }} />
              <Text style={{ color: C.t3, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
                Enter a target weight above to see which plates to load
              </Text>
            </View>
          )}

        </ScrollView>
      </View>
    </Modal>
  );
}

const fmtTimer = (s) => {
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
};

const EXERCISE_TIPS = {
  ex01:'Lie flat, grip bar just wider than shoulders. Lower to mid-chest with control, press to lockout. Keep feet flat and back naturally arched.',
  ex02:'Set bench 30–45°. Lower bar to upper chest, press up. Elbows at ~45° from body. Targets upper pecs.',
  ex03:'Feet secured, head lower than hips. Lower bar to lower chest and press up. Emphasises lower pec.',
  ex04:'Flat bench, press dumbbells from chest level to near lockout. Keep neutral wrist throughout.',
  ex05:'30–45° incline. Press dumbbells up and slightly together at top. Keep shoulders back.',
  ex06:'Wide arc down to chest level, maintain slight elbow bend throughout. Think "hugging a tree".',
  ex07:'Set cables at shoulder height. Arc hands together in front of chest, squeeze pecs hard at top.',
  ex08:'Hands shoulder-width, lower chest to floor. Keep core tight and body in a straight line.',
  ex09:'Lean slightly forward to hit chest. Lower until you feel a stretch, press back up.',
  ex10:'Bar over mid-foot, hinge at hips, flat back. Drive heels through the floor to lockout. The king of lifts.',
  ex11:'Overhand grip, pull chest to bar, lower with full control. Full hang at the bottom of every rep.',
  ex12:'Underhand grip, pull chest to bar. More bicep involvement than the pull-up.',
  ex13:'Slight lean back, pull bar to upper chest. Initiate with lats, not arms. Squeeze at the bottom.',
  ex14:'Sit tall, brace core. Pull handle to lower chest, elbows close to body. Pause and squeeze.',
  ex15:'Hinge to ~45°, pull bar to lower ribs. Drive elbows back, keep back flat throughout.',
  ex16:'Brace on bench, pull dumbbell to hip height. Elbow drives straight back like a saw.',
  ex17:'Straddle the bar, hinge forward. Pull to lower chest with a neutral grip, squeezing back.',
  ex18:'Rope at head height, pull apart and back toward your face. Great for rear delts and rotator cuff.',
  ex19:'Arms straight throughout, pull bar from overhead down to your thighs. Feel the lats stretch at top.',
  ex20:'Bar at collarbone, brace core and press overhead to lockout. Keep ribs down, no excessive lean.',
  ex21:'Press dumbbells from ear level to overhead. A slight forward angle is natural.',
  ex22:'Arms slightly bent, raise to shoulder height leading with your elbows. Control the descent slowly.',
  ex23:'Raise dumbbells in front to shoulder height. Keep a slight elbow bend. Lower with control.',
  ex24:'Hinge forward to ~45°, raise dumbbells to sides with slight elbow bend. Squeezes rear delts.',
  ex25:'Start with palms facing you at ear level, rotate outward as you press overhead. Great for shoulder health.',
  ex26:'Pull bar to chin with elbows flaring high and wide. Keep it close to your body throughout.',
  ex27:'Cable at hip level, raise arm to shoulder height. Constant tension vs dumbbells.',
  ex28:'Stand tall, curl bar to shoulder height. Keep elbows pinned at your sides throughout.',
  ex29:'Curl to shoulder, supinate your wrist at the top to fully contract the bicep.',
  ex30:'Neutral grip throughout the full movement. Also works brachialis and forearms.',
  ex31:'Chest against pad, full ROM from full extension to full contraction. Squeeze hard at top.',
  ex32:'Cable provides constant tension. Control the negative (lowering) slowly for more stimulus.',
  ex33:'Seated, elbow braced on inner thigh. Isolates the bicep completely. Squeeze hard at top.',
  ex34:'Elbows tucked at sides, push bar down to full extension. Squeeze triceps hard at bottom.',
  ex35:'Lower bar toward forehead, extend arms to lockout. Keep elbows pointing up and narrow.',
  ex36:'Grip just inside shoulder-width. Lower to chest, press to lockout. More tricep than standard bench.',
  ex37:'Arms close to body, lower until ~90°. Lean forward for chest, stay upright for triceps.',
  ex38:'Dumbbell or EZ-bar overhead, lower behind head. Keep elbows close to ears.',
  ex39:'Rope overhead, extend arms forward keeping elbows stationary. Triceps do all the work.',
  ex40:'Diamond (index+thumbs touching) hand position. Lower chest to hands, press up explosively.',
  ex41:'Bar on upper traps, feet shoulder-width. Squat below parallel, drive knees out and heels through the floor.',
  ex42:'Push hips back, bar close to legs, feel the hamstring stretch. Drive hips forward to stand.',
  ex43:'Feet shoulder-width on platform. Lower to ~90°, press to near lockout to keep tension on quads.',
  ex44:'Curl weight toward glutes with control. Pause at top, lower slowly for maximum hamstring work.',
  ex45:'Extend legs to near lockout, squeeze quads hard at the top. Lower with control.',
  ex46:'Full range: maximum stretch at bottom, maximum contraction at top. Pause and hold at top.',
  ex47:'Shoulders under pads, squat deep. Drive through heels, keep lower back pressed to pad.',
  ex48:'Rear foot elevated on bench, lower front knee toward floor. Stay upright through the torso.',
  ex49:'Long stride, lower back knee close to floor, step through without pausing.',
  ex50:'Hold dumbbell at chest, squat deep with elbows inside knees at the bottom. Keeps torso upright.',
  ex51:'Shoulders on bench, bar across hips. Drive hips up to full extension, squeeze glutes hard at top.',
  ex52:'Lie on back, feet flat. Drive hips up, squeezing glutes at the top. Great bodyweight glute builder.',
  ex53:'Cable at ankle, kick back and up with a straight leg. Squeeze the glute hard at the top.',
  ex54:'Wide stance, toes out, grip inside knees. Hinge and drive hips forward to lockout.',
  ex55:'Step up onto a box, driving through the heel of the lead leg. Control the descent.',
  ex56:'Elbows under shoulders, body in a perfectly straight line. Breathe steadily. Build duration gradually.',
  ex57:'Curl shoulders off the floor, exhale at the top. Hands lightly behind head — do not pull your neck.',
  ex58:'Sit at ~45°, lean back slightly. Rotate side to side. Add a weight plate to increase the challenge.',
  ex59:'Dead hang from bar. Raise legs to 90° (or toes to bar), lower with full control. No swinging.',
  ex60:'Kneeling, rope behind neck. Pull down by crunching at the spine, not by pulling with arms.',
  ex61:'On knees, core braced. Roll the wheel out until your hips nearly touch the floor, then pull back.',
  ex62:'On your elbow and the side of your foot. Hold body in a perfectly straight line. Works obliques.',
  ex63:'Adjust seat so handles align with mid-chest. Press forward to lockout, return with control.',
  ex64:'Keep elbows at shoulder height. Arc arms together in front, squeeze chest hard at full contraction.',
  ex65:'Bar fixed in landmine sleeve. Press at a natural angle — great for shoulder health and upper chest.',
  ex66:'Hands wider than shoulder-width. Targets the outer chest. Lower until chest nearly touches the floor.',
  ex67:'Bar set at knee height on a rack. Pull to hip extension — great for loading the upper back without full ROM.',
  ex68:'Lie prone on an incline bench. Pull dumbbells to ribcage, elbows tight to your sides. No momentum.',
  ex69:'Hang from a bar or rings below chest height. Pull chest to bar — great bodyweight horizontal row.',
  ex70:'Stand beside bar in a landmine, hinge at hip, row the end of the bar up to hip height with one arm.',
  ex71:'Use a single-hand attachment. Pull to shoulder with elbow flaring out. More isolation than bilateral.',
  ex72:'Bar on traps, hinge at hips, lower torso to ~45°. Drive hips forward to stand. Strengthens spinal erectors.',
  ex73:'Adjust seat and back pad. Press overhead through full range. Easier on shoulders than barbell variation.',
  ex74:'Set weight and rest arms on pads. Raise arms out to sides to shoulder height. Constant tension throughout.',
  ex75:'Stand tall, raise bar from hips to shoulder height with a slight elbow bend. Lower with control. Burns.',
  ex76:'Set cable at head height with rope. Pull rope apart and back toward your face. Crucial for rotator cuff health.',
  ex77:'Set bench to 30°, sit back, let arms hang. Curl dumbbells without swinging — full ROM and great stretch.',
  ex78:'Lie prone on an incline bench. Let arms hang, curl dumbbells up while keeping upper arms vertical. Intense peak contraction.',
  ex79:'Palms facing down, curl bar to shoulder height. Works brachialis and brachioradialis — forearm strength.',
  ex80:'Curl the dumbbell across your body toward the opposite shoulder. Targets brachialis and brachioradialis.',
  ex81:'Hinge forward with upper arm pinned at your side. Extend arm back and squeeze tricep hard at lockout.',
  ex82:'Rope attachment. Spread the rope at the bottom to fully extend the tricep. Control the negative.',
  ex83:'Bar in front rack or crossed-arm position. Squat deep with an upright torso. Quad dominant.',
  ex84:'Set a box behind you. Squat back onto it with control, pause, then drive up. Teaches hip-hinge squat pattern.',
  ex85:'Smith machine guides the bar. Safer for learning squat mechanics — can focus on depth and form.',
  ex86:'Lie face down, curl heels toward glutes. Pause at the top. Isolates hamstrings without lower back involvement.',
  ex87:'Bar on upper traps. Rise onto toes as high as possible, hold 1 second, lower slowly. Calf strength.',
  ex88:'Sit on the machine, pads across knees. Rise as high as possible, hold 1 second, lower slowly. Soleus focus.',
  ex89:'Anchor feet, kneel upright. Lower your body forward with a straight back. Eccentric hamstring strength.',
  ex90:'Stand facing a box. Jump onto it with both feet simultaneously, land softly with knees bent. Power training.',
  ex91:'On all fours, kick one leg back and up, squeeze glute hard at the top. Keep hips level.',
  ex92:'On all fours, raise one knee out to the side like a dog. Targets glute medius. Control is key.',
  ex93:'Wide stance, toes pointed out. Squat deep, keeping torso upright. Glutes and inner thighs.',
  ex94:'Feet off the floor, extend one leg while rotating elbow to opposite knee. Alternate continuously.',
  ex95:'Lie on back, lower back pressed down. Alternately extend arm and opposite leg — maintain braced core.',
  ex96:'Cable at chest height, hold handle at chest, step away from stack. Press straight out and return. Resists rotation.',
  ex97:'Lie flat, raise legs and torso simultaneously, reaching hands toward feet at the top. Full abs.',
  ex98:'Lie on back, hollow out your lower back, arms extended overhead. Hold the shape. Gymnastic core foundation.',
};

// ── 1RM CALCULATOR MODAL ──────────────────────────────────
function OneRMModal({ visible, onClose }) {
  const C = useContext(ThemeContext);
  const insets = useSafeAreaInsets();
  const [weightStr, setWeightStr] = useState('');
  const [repsStr,   setRepsStr]   = useState('');

  const weight = parseFloat(weightStr) || 0;
  const reps   = parseInt(repsStr)     || 0;
  const orm    = (weight > 0 && reps > 0 && reps <= 36)
    ? Math.round(weight * (1 + reps / 30) * 10) / 10
    : 0;

  const PCT_ROWS = [100, 97.5, 95, 92.5, 90, 85, 80, 75, 70];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex:1, backgroundColor:C.bg }}>
        <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between',
          paddingHorizontal:20, paddingTop: insets.top + 16, paddingBottom:12,
          borderBottomWidth:1, borderBottomColor:C.border }}>
          <Text style={{ fontSize:18, fontWeight:'700', color:C.t1 }}>1RM Calculator</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={C.t2} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding:20, paddingBottom:40 }} keyboardShouldPersistTaps="handled">
          {/* Inputs */}
          <View style={{ flexDirection:'row', gap:12, marginBottom:20 }}>
            <View style={{ flex:1 }}>
              <Text style={{ fontSize:12, fontWeight:'700', color:C.t3, marginBottom:6, letterSpacing:0.5 }}>WEIGHT (KG)</Text>
              <TextInput
                style={{ backgroundColor:C.surface, borderRadius:12, padding:14,
                  fontSize:22, fontWeight:'700', color:C.t1, textAlign:'center' }}
                value={weightStr}
                onChangeText={setWeightStr}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={C.t3}
                selectTextOnFocus
              />
            </View>
            <View style={{ flex:1 }}>
              <Text style={{ fontSize:12, fontWeight:'700', color:C.t3, marginBottom:6, letterSpacing:0.5 }}>REPS</Text>
              <TextInput
                style={{ backgroundColor:C.surface, borderRadius:12, padding:14,
                  fontSize:22, fontWeight:'700', color:C.t1, textAlign:'center' }}
                value={repsStr}
                onChangeText={setRepsStr}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={C.t3}
                selectTextOnFocus
              />
            </View>
          </View>

          {/* Result */}
          {orm > 0 ? (
            <>
              <View style={{ backgroundColor:C.surface, borderRadius:16, padding:20,
                alignItems:'center', marginBottom:20 }}>
                <Text style={{ fontSize:13, fontWeight:'700', color:C.t3, letterSpacing:1, marginBottom:6 }}>ESTIMATED 1RM</Text>
                <Text style={{ fontSize:48, fontWeight:'800', color:C.accent }}>{orm}</Text>
                <Text style={{ fontSize:16, color:C.t2, fontWeight:'600' }}>kg</Text>
                <Text style={{ fontSize:11, color:C.t3, marginTop:8 }}>Epley formula · {weight} kg × {reps} reps</Text>
              </View>

              {/* Percentage table */}
              <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                <Text style={{ fontSize:12, fontWeight:'700', color:C.t3, letterSpacing:1 }}>TRAINING PERCENTAGES</Text>
                <Text style={{ fontSize:11, color:C.t3 }}>tap row to use weight</Text>
              </View>
              <View style={{ backgroundColor:C.surface, borderRadius:16, overflow:'hidden' }}>
                {PCT_ROWS.map((pct, i) => {
                  const val = Math.round(orm * pct / 100 * 4) / 4;
                  const isTop = i === 0;
                  return (
                    <TouchableOpacity key={pct} activeOpacity={0.65}
                      onPress={() => setWeightStr(String(val))}
                      style={{ flexDirection:'row', justifyContent:'space-between',
                        alignItems:'center', paddingHorizontal:16, paddingVertical:13,
                        borderTopWidth: i > 0 ? 1 : 0, borderTopColor:C.border }}>
                      <Text style={{ fontSize:15, fontWeight:'600', color: isTop ? C.accent : C.t2 }}>{pct}%</Text>
                      <View style={{ flexDirection:'row', alignItems:'center', gap:10 }}>
                        <Text style={{ fontSize:15, fontWeight:'700', color: isTop ? C.accent : C.t1 }}>{val} kg</Text>
                        <Ionicons name="arrow-up-circle-outline" size={16} color={isTop ? C.accent : C.t3} />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          ) : (
            <View style={{ alignItems:'center', paddingTop:40 }}>
              <Ionicons name="barbell-outline" size={48} color={C.t3} />
              <Text style={{ fontSize:15, color:C.t3, marginTop:12, textAlign:'center' }}>
                Enter weight and reps{'\n'}to calculate your 1RM
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── EXERCISE PICKER MODAL ─────────────────────────────────
function ExercisePickerModal({ visible, onClose, onSelect, title='Add Exercise', excludeIds=[] }) {
  const C = useContext(ThemeContext);
  const wkStyles = mkWkStyles(C);
  const [query,           setQuery]           = useState('');
  const [muscle,          setMuscle]          = useState('All');
  const [customExercises, setCustomExercises] = useState([]);
  const insets = useSafeAreaInsets();
  useEffect(() => { if (!visible) { setQuery(''); setMuscle('All'); } }, [visible]);
  useEffect(() => {
    if (visible) getJson(CUSTOM_EXERCISES_KEY, []).then(setCustomExercises);
  }, [visible]);
  const allExercises = [...EXERCISE_DB, ...customExercises];
  const filtered = allExercises.filter(e =>
    !excludeIds.includes(e.id) &&
    (muscle === 'All' || e.muscle === muscle) &&
    (!query || e.name.toLowerCase().includes(query.toLowerCase()) || e.muscle.toLowerCase().includes(query.toLowerCase()))
  ).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[wkStyles.pickerScreen, { paddingTop: insets.top }]}>
        <SwipeBackEdge onBack={onClose} />
        <View style={wkStyles.pickerHeader}>
          <TouchableOpacity onPress={onClose} hitSlop={12}><Text style={wkStyles.pickerCancel}>Cancel</Text></TouchableOpacity>
          <Text style={wkStyles.pickerTitle}>{title}</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={wkStyles.pickerSearch}>
          <Ionicons name="search" size={16} color={C.t3} />
          <TextInput style={wkStyles.pickerSearchInput} value={query} onChangeText={setQuery}
            placeholder="Search exercises…" placeholderTextColor={C.t3} />
        </View>
        <View style={{ height: 104 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingVertical: 6 }}>
            {MUSCLES.map(m => {
              const active = muscle === m;
              return (
                <TouchableOpacity
                  key={m}
                  onPress={() => setMuscle(m)}
                  activeOpacity={0.75}
                  style={{
                    alignItems: 'center', gap: 4,
                    paddingHorizontal: 10, paddingTop: 8, paddingBottom: 8,
                    borderRadius: 14, borderWidth: 1.5,
                    borderColor: active ? C.accent : 'transparent',
                    backgroundColor: active ? C.accent + '1A' : C.s2,
                    minWidth: 68,
                  }}
                >
                  {m === 'All'
                    ? <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="grid-outline" size={30} color={active ? C.accent : C.t2} />
                      </View>
                    : <MuscleSprite muscle={m} size={44} />
                  }
                  <Text style={{ fontSize: 10, fontWeight: '700', color: active ? C.accent : C.t1 }}>{m}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
        <FlatList
          data={filtered}
          keyExtractor={e => String(e.id)}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom:40 }}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={10}
          removeClippedSubviews={false}
          getItemLayout={(_, index) => ({ length: 68, offset: 68 * index, index })}
          renderItem={({ item: e }) => (
            <TouchableOpacity style={wkStyles.exerciseRow} onPress={() => onSelect(e)} activeOpacity={0.7}>
              <MuscleSprite muscle={e.muscle} size={44} detail={false} />
              <View style={{ flex:1 }}>
                <Text style={wkStyles.exerciseName}>{e.name}</Text>
                <Text style={wkStyles.exerciseSub}>{e.muscle} · {e.equipment}</Text>
              </View>
              <Ionicons name="add-circle-outline" size={22} color={C.accent} />
            </TouchableOpacity>
          )}
        />
      </View>
    </Modal>
  );
}

// ── ROUTINE BUILDER MODAL ─────────────────────────────────
function RoutineBuilderModal({ routine, onSave, onClose }) {
  const C = useContext(ThemeContext);
  const wkStyles = mkWkStyles(C);
  const [name,       setName]       = useState(routine.name || '');
  const [exercises,  setExercises]  = useState(routine.exercises || []);
  const [showPicker, setShowPicker] = useState(false);
  const [nameError,  setNameError]  = useState(false);
  const insets = useSafeAreaInsets();
  const addEx  = (def) => { setExercises(p => [...p, { exerciseId:def.id, name:def.name, muscle:def.muscle }]); setShowPicker(false); };
  const save   = () => {
    if (!name.trim()) { setNameError(true); Alert.alert('Name required', 'Enter a name for this routine.'); return; }
    onSave({ ...routine, name:name.trim(), exercises });
  };
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[wkStyles.pickerScreen, { paddingTop:insets.top }]}>
        <SwipeBackEdge onBack={onClose} />

        {/* Header */}
        <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingVertical:14, borderBottomWidth:0.5, borderBottomColor:C.border }}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={{ fontSize:15, color:C.accent }}>Cancel</Text>
          </TouchableOpacity>
          <Text style={{ fontSize:17, fontWeight:'700', color:C.t1 }}>{routine.id ? 'Edit Routine' : 'New Routine'}</Text>
          <TouchableOpacity onPress={save} hitSlop={12}>
            <Text style={{ fontSize:15, fontWeight:'700', color:C.accent }}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom:60 }}>

          {/* Name input card */}
          <View style={{ marginHorizontal:16, marginTop:20, marginBottom:6, backgroundColor:C.surface, borderRadius:16, paddingHorizontal:16, paddingVertical:14 }}>
            <Text style={{ fontSize:11, fontWeight:'700', color:C.t3, letterSpacing:1.2, marginBottom:10 }}>ROUTINE NAME</Text>
            <TextInput
              style={[{ fontSize:20, fontWeight:'800', color:C.t1, letterSpacing:-0.3 }, nameError && { color:'#FF453A' }]}
              value={name}
              onChangeText={v => { setName(v); if (v.trim()) setNameError(false); }}
              placeholder="e.g. Push Day"
              placeholderTextColor={C.t3}
              autoFocus
            />
            {nameError && (
              <Text style={{ color:'#FF453A', fontSize:12, marginTop:8, fontWeight:'500' }}>Enter a name to continue</Text>
            )}
          </View>

          {/* Exercises section */}
          <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, marginTop:24, marginBottom:10 }}>
            <Text style={{ fontSize:13, fontWeight:'700', color:C.t3, letterSpacing:1 }}>EXERCISES</Text>
            <Text style={{ fontSize:13, fontWeight:'600', color:C.t3 }}>{exercises.length}</Text>
          </View>

          {exercises.length === 0 && (
            <View style={{ marginHorizontal:16, backgroundColor:C.surface, borderRadius:14, padding:20, alignItems:'center' }}>
              <Ionicons name="barbell-outline" size={28} color={C.t3} />
              <Text style={{ color:C.t3, fontSize:14, fontWeight:'500', marginTop:10 }}>No exercises yet</Text>
              <Text style={{ color:C.t3, fontSize:12, marginTop:4 }}>Tap below to add your first one</Text>
            </View>
          )}

          {exercises.map((e, i) => {
            const accentColor = MUSCLE_META[e.muscle]?.color || C.accent;
            return (
              <View key={i} style={{ marginHorizontal:16, marginBottom:8, borderRadius:14, overflow:'hidden', backgroundColor:C.surface, flexDirection:'row', alignItems:'center' }}>
                <View style={{ width:4, alignSelf:'stretch', backgroundColor:accentColor }} />
                <View style={{ flex:1, paddingHorizontal:14, paddingVertical:13 }}>
                  <Text style={{ fontSize:15, fontWeight:'700', color:C.t1, marginBottom:2 }}>{e.name}</Text>
                  {e.muscle ? (
                    <View style={{ flexDirection:'row', alignItems:'center', gap:6 }}>
                      <View style={{ backgroundColor:accentColor+'22', borderRadius:6, paddingHorizontal:7, paddingVertical:2 }}>
                        <Text style={{ fontSize:10, fontWeight:'700', color:accentColor }}>{e.muscle}</Text>
                      </View>
                    </View>
                  ) : null}
                </View>
                <TouchableOpacity
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setExercises(p => p.filter((_,j) => j!==i)); }}
                  hitSlop={10} style={{ paddingRight:16 }}>
                  <Ionicons name="remove-circle" size={24} color="#FF453A" />
                </TouchableOpacity>
              </View>
            );
          })}

          {/* Add exercise button */}
          <TouchableOpacity
            style={{ marginHorizontal:16, marginTop:8, borderRadius:14, backgroundColor:C.surface,
              flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8, paddingVertical:16,
              borderWidth:1.5, borderColor:C.accent+'44', borderStyle:'dashed' }}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowPicker(true); }}>
            <Ionicons name="add-circle" size={20} color={C.accent} />
            <Text style={{ fontSize:15, fontWeight:'700', color:C.accent }}>Add Exercise</Text>
          </TouchableOpacity>

          {/* Save button */}
          <TouchableOpacity
            style={{ marginHorizontal:16, marginTop:24, borderRadius:14, backgroundColor:C.accent,
              paddingVertical:16, alignItems:'center' }}
            onPress={save} activeOpacity={0.85}>
            <Text style={{ fontSize:16, fontWeight:'800', color:'#fff' }}>
              {routine.id ? 'Save Changes' : 'Create Routine'}
            </Text>
          </TouchableOpacity>

        </ScrollView>
      </View>
      <ExercisePickerModal visible={showPicker} onClose={() => setShowPicker(false)} onSelect={addEx}
        title="Add to Routine" excludeIds={exercises.map(e => e.exerciseId)} />
    </Modal>
  );
}

// ── POP MENU — animated overlay dropdown ─────────────────
function PopMenu({ style, children }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, tension: 320, friction: 24 }).start();
  }, []);
  return (
    <Animated.View style={[style, {
      opacity: anim,
      transform: [
        { scale:      anim.interpolate({ inputRange:[0,1], outputRange:[0.93,1] }) },
        { translateY: anim.interpolate({ inputRange:[0,1], outputRange:[-8,0] }) },
      ],
    }]}>
      {children}
    </Animated.View>
  );
}

// ── SWIPE-BACK EDGE STRIP ────────────────────────────────
function SwipeBackEdge({ onBack }) {
  const cb = useRef(onBack);
  cb.current = onBack;
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => g.dx > 8 && Math.abs(g.dy) < Math.abs(g.dx),
    onPanResponderRelease: (_, g) => { if (g.dx > 50) cb.current?.(); },
  })).current;
  return (
    <View
      style={{ position:'absolute', left:0, top:0, bottom:0, width:28, zIndex:200 }}
      {...pan.panHandlers}
    />
  );
}

// ── EXERCISE LIBRARY MODAL ───────────────────────────────
function ExerciseLibraryModal({ visible, onClose, onAddToWorkout }) {
  const C = useContext(ThemeContext);
  const wkStyles = mkWkStyles(C);
  const [query,           setQuery]           = useState('');
  const [bodyFilter,      setBodyFilter]      = useState('All');
  const [equipFilter,     setEquipFilter]     = useState('All');
  const [detail,          setDetail]          = useState(null);
  const [pickSets,        setPickSets]        = useState(false);
  const [showBodyDrop,    setShowBodyDrop]    = useState(false);
  const [showEquipDrop,   setShowEquipDrop]   = useState(false);
  const [showSortDrop,    setShowSortDrop]    = useState(false);
  const [sortAsc,         setSortAsc]         = useState(true);
  const [showCreate,      setShowCreate]      = useState(false);
  const [customExercises, setCustomExercises] = useState([]);
  const scrollRef        = useRef(null);   // SectionList ref
  const scrubRef         = useRef(null);
  const scrubInfo        = useRef({ pageY: 0, height: 0 });
  const lettersRef       = useRef([]);
  const sectionsRef      = useRef([]);
  const backRef          = useRef(null);
  const insets           = useSafeAreaInsets();

  useEffect(() => {
    if (!visible) {
      setQuery(''); setBodyFilter('All'); setEquipFilter('All');
      setDetail(null); setPickSets(false);
      setShowBodyDrop(false); setShowEquipDrop(false); setShowSortDrop(false);
    }
  }, [visible]);

  useEffect(() => {
    if (visible) getJson(CUSTOM_EXERCISES_KEY, []).then(setCustomExercises);
  }, [visible]);

  const BODY_PARTS = ['All','Chest','Back','Shoulders','Biceps','Triceps','Legs','Glutes','Core'];
  const EQUIP_CATS = ['All','Barbell','Dumbbell','Cable','Machine','Bodyweight','Kettlebell','Other'];

  const allExercises = [...EXERCISE_DB, ...customExercises];

  const filtered = allExercises
    .filter(e =>
      (bodyFilter === 'All' || e.muscle === bodyFilter) &&
      (equipFilter === 'All' || e.equipment === equipFilter) &&
      (!query || e.name.toLowerCase().includes(query.toLowerCase()) || e.muscle.toLowerCase().includes(query.toLowerCase()))
    )
    .sort((a, b) => sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));

  const sections = [];
  const sectionMap = {};
  for (const ex of filtered) {
    const letter = ex.name[0].toUpperCase();
    if (!sectionMap[letter]) { sectionMap[letter] = []; sections.push({ title: letter, data: sectionMap[letter] }); }
    sectionMap[letter].push(ex);
  }
  const letters = sections.map(s => s.title);
  sectionsRef.current = sections;
  lettersRef.current  = letters;

  const saveCustom = async (ex) => {
    const updated = [...customExercises, ex];
    setCustomExercises(updated);
    await AsyncStorage.setItem(CUSTOM_EXERCISES_KEY, JSON.stringify(updated));
    setShowCreate(false);
  };

  const deleteCustom = async (id) => {
    const updated = customExercises.filter(e => e.id !== id);
    setCustomExercises(updated);
    await AsyncStorage.setItem(CUSTOM_EXERCISES_KEY, JSON.stringify(updated));
  };

  const closeDrops = () => { setShowBodyDrop(false); setShowEquipDrop(false); setShowSortDrop(false); };

  backRef.current = () => {
    if (pickSets) { setPickSets(false); return; }
    if (detail)   { setDetail(null);   return; }
    onClose();
  };

  return (
    <View style={[StyleSheet.absoluteFillObject, { zIndex:50, display: visible ? 'flex' : 'none' }]}>
      <View style={[wkStyles.pickerScreen, { paddingTop: insets.top }]}>

        {(detail || pickSets) && <SwipeBackEdge onBack={backRef.current} />}

        {/* ── PICK SETS ── */}
        {pickSets && detail ? (
          <>
            <View style={wkStyles.pickerHeader}>
              <TouchableOpacity onPress={() => setPickSets(false)} hitSlop={12}><Text style={wkStyles.pickerCancel}>Back</Text></TouchableOpacity>
              <Text style={wkStyles.pickerTitle}>How many sets?</Text>
              <View style={{ width:60 }} />
            </View>
            <View style={{ padding:24 }}>
              <Text style={{ fontSize:14, color:C.t3, marginBottom:24 }}>{detail.name}</Text>
              <View style={{ flexDirection:'row', gap:8 }}>
                {[1,2,3,4,5,6,7].map(n => (
                  <TouchableOpacity key={n}
                    style={{ flex:1, backgroundColor:C.s2, borderRadius:12, paddingVertical:18, alignItems:'center' }}
                    onPress={() => { onAddToWorkout(detail, n); setPickSets(false); setDetail(null); onClose(); }}
                  >
                    <Text style={{ color:C.t1, fontSize:20, fontWeight:'800' }}>{n}</Text>
                    <Text style={{ color:C.t3, fontSize:10, marginTop:3 }}>{n===1?'set':'sets'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity onPress={() => setPickSets(false)} style={{ marginTop:20, alignItems:'center' }}>
                <Text style={{ color:C.t3, fontSize:14 }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </>

        /* ── EXERCISE DETAIL ── */
        ) : detail ? (
          <>
            <View style={wkStyles.pickerHeader}>
              <TouchableOpacity onPress={() => setDetail(null)} hitSlop={12}><Text style={wkStyles.pickerCancel}>Back</Text></TouchableOpacity>
              <Text style={wkStyles.pickerTitle}>{detail.name}</Text>
              <View style={{ width:60 }} />
            </View>
            <ScrollView contentContainerStyle={{ padding:20, paddingBottom:60 }}>
              <View style={{ flexDirection:'row', gap:12, marginBottom:24, alignItems:'center' }}>
                <MuscleSprite muscle={detail.muscle} size={80} detail={true} />
                <View>
                  <View style={{ backgroundColor:C.s2, borderRadius:20, paddingHorizontal:12, paddingVertical:5, marginBottom:6 }}>
                    <Text style={{ color:MUSCLE_META[detail.muscle]?.color||C.accent, fontSize:12, fontWeight:'700' }}>{detail.muscle}</Text>
                  </View>
                  <View style={{ backgroundColor:C.s2, borderRadius:20, paddingHorizontal:12, paddingVertical:5 }}>
                    <Text style={{ color:C.t2, fontSize:12, fontWeight:'600' }}>{detail.equipment}</Text>
                  </View>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => Linking.openURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(detail.name + ' exercise tutorial')}`)}
                activeOpacity={0.75}
                style={{ flexDirection:'row', alignItems:'center', gap:10, backgroundColor:C.s2,
                         borderRadius:12, paddingHorizontal:16, paddingVertical:13, marginBottom:24 }}
              >
                <Ionicons name="logo-youtube" size={20} color="#FF0000" />
                <Text style={{ color:C.t1, fontSize:14, fontWeight:'600' }}>Watch on YouTube</Text>
                <Ionicons name="open-outline" size={14} color={C.t3} style={{ marginLeft:'auto' }} />
              </TouchableOpacity>
              <Text style={{ fontSize:17, fontWeight:'700', color:C.t1, marginBottom:12 }}>How to perform</Text>
              <Text style={{ fontSize:15, color:C.t2, lineHeight:24 }}>
                {EXERCISE_TIPS[detail.id] || 'Focus on controlled movement through the full range of motion. Prioritise form over weight.'}
              </Text>
              {onAddToWorkout && (
                <TouchableOpacity
                  style={{ backgroundColor:C.accent, borderRadius:14, paddingVertical:16, alignItems:'center', marginTop:36 }}
                  onPress={() => setPickSets(true)} activeOpacity={0.85}>
                  <Text style={{ color:'#fff', fontSize:16, fontWeight:'700' }}>Add to Workout</Text>
                </TouchableOpacity>
              )}
              {detail.isCustom && (
                <TouchableOpacity
                  style={{ paddingVertical:14, alignItems:'center', marginTop:8 }}
                  onPress={() => Alert.alert('Delete Exercise', 'Remove this custom exercise?', [
                    { text:'Cancel', style:'cancel' },
                    { text:'Delete', style:'destructive', onPress: async () => { await deleteCustom(detail.id); setDetail(null); }},
                  ])}>
                  <Text style={{ color:'#FF453A', fontSize:14, fontWeight:'600' }}>Delete Exercise</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </>

        /* ── MAIN LIST ── */
        ) : (
          <>
            {/* Header */}
            <View style={[wkStyles.pickerHeader, { paddingHorizontal:16 }]}>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <Text style={wkStyles.pickerCancel}>Close</Text>
              </TouchableOpacity>
              <Text style={wkStyles.pickerTitle}>Exercises</Text>
              <TouchableOpacity onPress={() => setShowCreate(true)} hitSlop={12}>
                <Text style={{ color:C.accent, fontSize:15, fontWeight:'700' }}>+ New</Text>
              </TouchableOpacity>
            </View>

            {/* Search */}
            <View style={wkStyles.pickerSearch}>
              <Ionicons name="search" size={16} color={C.t3} />
              <TextInput style={wkStyles.pickerSearchInput} value={query} onChangeText={v => { setQuery(v); closeDrops(); }}
                placeholder="Search exercises…" placeholderTextColor={C.t3} />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={C.t3} />
                </TouchableOpacity>
              )}
            </View>

            {/* Filter row */}
            <View style={{ flexDirection:'row', gap:8, paddingHorizontal:12, paddingBottom:10 }}>
              <TouchableOpacity onPress={() => { setShowBodyDrop(p=>!p); setShowEquipDrop(false); setShowSortDrop(false); }}
                style={{ flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:5,
                         backgroundColor: bodyFilter!=='All' ? C.accent : C.s2, borderRadius:10, paddingVertical:8 }}>
                <Text style={{ fontSize:12, fontWeight:'700', color: bodyFilter!=='All'?'#fff':C.t1 }} numberOfLines={1}>
                  {bodyFilter==='All' ? 'Any Body Part' : bodyFilter}
                </Text>
                <Ionicons name={showBodyDrop ? 'chevron-up' : 'chevron-down'} size={11} color={bodyFilter!=='All'?'#fff':C.t3} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setShowEquipDrop(p=>!p); setShowBodyDrop(false); setShowSortDrop(false); }}
                style={{ flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:5,
                         backgroundColor: equipFilter!=='All' ? C.accent : C.s2, borderRadius:10, paddingVertical:8 }}>
                <Text style={{ fontSize:12, fontWeight:'700', color: equipFilter!=='All'?'#fff':C.t1 }} numberOfLines={1}>
                  {equipFilter==='All' ? 'Any Category' : equipFilter}
                </Text>
                <Ionicons name={showEquipDrop ? 'chevron-up' : 'chevron-down'} size={11} color={equipFilter!=='All'?'#fff':C.t3} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setShowSortDrop(p=>!p); setShowBodyDrop(false); setShowEquipDrop(false); }}
                style={{ backgroundColor: showSortDrop ? C.accent : C.s2, borderRadius:10, paddingHorizontal:13, paddingVertical:8, alignItems:'center', justifyContent:'center' }}>
                <Ionicons name="swap-vertical-outline" size={17} color={C.t1} />
              </TouchableOpacity>
            </View>

            {/* List + overlay dropdowns + A-Z scrubber */}
            <View style={{ flex:1, position:'relative' }}>

              {/* Exercise list — SectionList for virtualised rendering */}
              <SectionList
                ref={scrollRef}
                sections={sections}
                keyExtractor={e => String(e.id)}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom:100, paddingRight:24 }}
                stickySectionHeadersEnabled={false}
                initialNumToRender={20}
                maxToRenderPerBatch={20}
                windowSize={10}
                removeClippedSubviews={false}
                onScrollBeginDrag={closeDrops}
                renderSectionHeader={({ section }) => (
                  <View style={{ flexDirection:'row', alignItems:'center', paddingHorizontal:16, paddingTop:14, paddingBottom:5 }}>
                    <Text style={{ fontSize:13, fontWeight:'800', color:C.t3, marginRight:8 }}>{section.title}</Text>
                    <View style={{ height:0.5, flex:1, backgroundColor:C.border }} />
                  </View>
                )}
                renderItem={({ item: e }) => (
                  <TouchableOpacity style={wkStyles.exerciseRow} onPress={() => setDetail(e)} activeOpacity={0.7}>
                    <MuscleSprite muscle={e.muscle} size={44} detail={false} />
                    <View style={{ flex:1 }}>
                      <View style={{ flexDirection:'row', alignItems:'center', gap:5 }}>
                        <Text style={wkStyles.exerciseName}>{e.name}</Text>
                        {e.isCustom && <View style={{ backgroundColor:C.accent+'30', borderRadius:4, paddingHorizontal:5, paddingVertical:1 }}>
                          <Text style={{ fontSize:9, color:C.accent, fontWeight:'800' }}>CUSTOM</Text>
                        </View>}
                      </View>
                      <Text style={wkStyles.exerciseSub}>{e.muscle} · {e.equipment}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={C.t3} />
                  </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={{ color:C.t3, textAlign:'center', marginTop:48, fontSize:14 }}>No exercises found</Text>}
              />

              {/* A-Z scrubber — uses scrollToLocation, no pixel tracking needed */}
              {!query && letters.length > 1 && (() => {
                const jumpTo = (pageY) => {
                  const { pageY: top, height } = scrubInfo.current;
                  if (!height) return;
                  const pct = Math.max(0, Math.min(0.999, (pageY - top) / height));
                  const letter = lettersRef.current[Math.floor(pct * lettersRef.current.length)];
                  const sIdx = sectionsRef.current.findIndex(s => s.title === letter);
                  if (sIdx >= 0) {
                    try {
                      scrollRef.current?.scrollToLocation({ sectionIndex: sIdx, itemIndex: 0, animated: false, viewOffset: 0 });
                    } catch (_) {}
                  }
                };
                return (
                  <View
                    ref={scrubRef}
                    style={{ position:'absolute', right:0, top:0, bottom:0, width:20, justifyContent:'space-evenly', alignItems:'center' }}
                    onLayout={() => scrubRef.current?.measure((_x,_y,_w,h,_px,py) => { scrubInfo.current = { pageY: py, height: h }; })}
                    onStartShouldSetResponder={() => true}
                    onMoveShouldSetResponder={() => true}
                    onResponderGrant={e => jumpTo(e.nativeEvent.pageY)}
                    onResponderMove={e => jumpTo(e.nativeEvent.pageY)}
                  >
                    {letters.map(letter => (
                      <Text key={letter} style={{ fontSize:9, fontWeight:'800', color:C.accent, paddingVertical:1.5, lineHeight:11 }}>{letter}</Text>
                    ))}
                  </View>
                );
              })()}

              {/* Backdrop — dismisses any open dropdown on outside tap */}
              {(showBodyDrop || showEquipDrop || showSortDrop) && (
                <TouchableOpacity
                  style={{ position:'absolute', top:0, left:0, right:0, bottom:0, zIndex:50 }}
                  activeOpacity={1}
                  onPress={closeDrops}
                />
              )}

              {/* Body Part dropdown — floats above list */}
              {showBodyDrop && (
                <PopMenu style={{ position:'absolute', top:0, left:12, right:60, zIndex:100,
                                  backgroundColor:C.surface, borderRadius:14,
                                  shadowColor:'#000', shadowOpacity:0.5, shadowRadius:12, shadowOffset:{width:0,height:4}, elevation:14 }}>
                  {BODY_PARTS.map((bp, i) => (
                    <TouchableOpacity key={bp} onPress={() => { setBodyFilter(bp); setShowBodyDrop(false); }}
                      style={[{ flexDirection:'row', alignItems:'center', justifyContent:'space-between',
                                 paddingHorizontal:16, paddingVertical:13 },
                               i < BODY_PARTS.length-1 && { borderBottomWidth:0.5, borderBottomColor:C.border }]}>
                      <Text style={{ fontSize:15, color:bodyFilter===bp?C.accent:C.t1, fontWeight:bodyFilter===bp?'700':'400' }}>
                        {bp==='All'?'Any Body Part':bp}
                      </Text>
                      {bodyFilter===bp && <Ionicons name="checkmark" size={16} color={C.accent} />}
                    </TouchableOpacity>
                  ))}
                </PopMenu>
              )}

              {/* Equipment dropdown — floats above list */}
              {showEquipDrop && (
                <PopMenu style={{ position:'absolute', top:0, left:12, right:60, zIndex:100,
                                  backgroundColor:C.surface, borderRadius:14,
                                  shadowColor:'#000', shadowOpacity:0.5, shadowRadius:12, shadowOffset:{width:0,height:4}, elevation:14 }}>
                  {EQUIP_CATS.map((eq, i) => (
                    <TouchableOpacity key={eq} onPress={() => { setEquipFilter(eq); setShowEquipDrop(false); }}
                      style={[{ flexDirection:'row', alignItems:'center', justifyContent:'space-between',
                                 paddingHorizontal:16, paddingVertical:13 },
                               i < EQUIP_CATS.length-1 && { borderBottomWidth:0.5, borderBottomColor:C.border }]}>
                      <Text style={{ fontSize:15, color:equipFilter===eq?C.accent:C.t1, fontWeight:equipFilter===eq?'700':'400' }}>
                        {eq==='All'?'Any Category':eq}
                      </Text>
                      {equipFilter===eq && <Ionicons name="checkmark" size={16} color={C.accent} />}
                    </TouchableOpacity>
                  ))}
                </PopMenu>
              )}

              {/* Sort dropdown — floats above list, right-aligned */}
              {showSortDrop && (
                <PopMenu style={{ position:'absolute', top:0, right:12, width:190, zIndex:100,
                                  backgroundColor:C.surface, borderRadius:14,
                                  shadowColor:'#000', shadowOpacity:0.5, shadowRadius:12, shadowOffset:{width:0,height:4}, elevation:14 }}>
                  {[{ label:'Name (A–Z)', asc:true }, { label:'Name (Z–A)', asc:false }].map((opt, i) => (
                    <TouchableOpacity key={opt.label} onPress={() => { setSortAsc(opt.asc); setShowSortDrop(false); }}
                      style={[{ flexDirection:'row', alignItems:'center', justifyContent:'space-between',
                                 paddingHorizontal:16, paddingVertical:14 },
                               i===0 && { borderBottomWidth:0.5, borderBottomColor:C.border }]}>
                      <Text style={{ fontSize:15, color:sortAsc===opt.asc?C.accent:C.t1, fontWeight:sortAsc===opt.asc?'700':'400' }}>{opt.label}</Text>
                      {sortAsc===opt.asc && <Ionicons name="checkmark" size={16} color={C.accent} />}
                    </TouchableOpacity>
                  ))}
                </PopMenu>
              )}
            </View>
          </>
        )}

      </View>

      {/* Create exercise sheet */}
      {showCreate && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setShowCreate(false)}>
          <TouchableOpacity style={{ flex:1, backgroundColor:'rgba(0,0,0,0.5)' }} activeOpacity={1} onPress={() => setShowCreate(false)} />
          <CreateExerciseSheet onSave={saveCustom} onClose={() => setShowCreate(false)} />
        </Modal>
      )}

    </View>
  );
}

// ── CREATE EXERCISE SHEET ─────────────────────────────────
function CreateExerciseSheet({ onSave, onClose }) {
  const [name,      setName]      = useState('');
  const [muscle,    setMuscle]    = useState('');
  const [equipment, setEquipment] = useState('');

  const BODY_PARTS = ['Chest','Back','Shoulders','Biceps','Triceps','Legs','Glutes','Core'];
  const EQUIP_CATS = ['Barbell','Dumbbell','Cable','Machine','Bodyweight','Kettlebell','Other'];

  const handleSave = () => {
    if (!name.trim())  { Alert.alert('Name required', 'Enter an exercise name.'); return; }
    if (!muscle)       { Alert.alert('Body part required', 'Select a body part.'); return; }
    if (!equipment)    { Alert.alert('Category required', 'Select a category.'); return; }
    onSave({ id:`custom_${Date.now()}`, name:name.trim(), muscle, equipment, isCustom:true });
  };

  return (
    <View style={{ backgroundColor:C.surface, borderTopLeftRadius:24, borderTopRightRadius:24, paddingTop:16, paddingBottom:48 }}>
      <View style={{ width:36, height:4, borderRadius:2, backgroundColor:C.s3, alignSelf:'center', marginBottom:16 }} />
      <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:20, marginBottom:20 }}>
        <TouchableOpacity onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={24} color={C.t1} />
        </TouchableOpacity>
        <Text style={{ fontSize:17, fontWeight:'700', color:C.t1 }}>Create New Exercise</Text>
        <TouchableOpacity onPress={handleSave} hitSlop={12}>
          <Text style={{ color:C.accent, fontSize:16, fontWeight:'700' }}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal:20, paddingBottom:20 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color:C.t2, fontSize:13, fontWeight:'600', marginBottom:8 }}>Name</Text>
        <TextInput
          style={{ backgroundColor:C.s2, color:C.t1, fontSize:16, borderRadius:12,
                   paddingHorizontal:14, paddingVertical:13, marginBottom:22 }}
          value={name} onChangeText={setName}
          placeholder="Add Name" placeholderTextColor={C.t3} autoFocus
        />

        <Text style={{ color:C.t2, fontSize:13, fontWeight:'600', marginBottom:10 }}>Body Part</Text>
        <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:22 }}>
          {BODY_PARTS.map(bp => (
            <TouchableOpacity key={bp} onPress={() => setMuscle(bp)} activeOpacity={0.75}
              style={{ backgroundColor:muscle===bp ? (MUSCLE_META[bp]?.color||C.accent) : C.s2,
                       borderRadius:10, paddingHorizontal:14, paddingVertical:9 }}>
              <Text style={{ color:muscle===bp?'#fff':C.t1, fontSize:14, fontWeight:'600' }}>{bp}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={{ color:C.t2, fontSize:13, fontWeight:'600', marginBottom:10 }}>Category</Text>
        <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8 }}>
          {EQUIP_CATS.map(cat => (
            <TouchableOpacity key={cat} onPress={() => setEquipment(cat)} activeOpacity={0.75}
              style={{ flexDirection:'row', alignItems:'center', gap:6,
                       backgroundColor:equipment===cat ? C.accent : C.s2,
                       borderRadius:10, paddingHorizontal:12, paddingVertical:9 }}>
              <Ionicons name={EQUIP_ICON[cat]||'barbell-outline'} size={14}
                        color={equipment===cat?'#fff':C.t3} />
              <Text style={{ color:equipment===cat?'#fff':C.t1, fontSize:14, fontWeight:'600' }}>{cat}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

// ── SWIPEABLE SET ROW ─────────────────────────────────────
function SwipeableSetRow({ children, onDelete }) {
  const C          = useContext(ThemeContext);
  const translateX = useRef(new Animated.Value(0)).current;
  const onDeleteRef = useRef(onDelete);
  const deletedRef  = useRef(false);
  useEffect(() => { onDeleteRef.current = onDelete; }, [onDelete]);

  const clampedX = translateX.interpolate({
    inputRange: [-500, 0], outputRange: [-500, 0], extrapolate: 'clamp',
  });
  const bgOpacity = translateX.interpolate({
    inputRange: [-80, -10, 0], outputRange: [1, 0.5, 0], extrapolate: 'clamp',
  });

  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetX([-10, 5])
    .failOffsetY([-12, 12])
    .runOnJS(true)
    .onBegin(() => { deletedRef.current = false; })
    .onUpdate((e) => { if (e.translationX < 0) translateX.setValue(e.translationX); })
    .onEnd((e) => {
      if (e.translationX < -80) {
        deletedRef.current = true;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        Animated.timing(translateX, { toValue: -500, duration: 180, useNativeDriver: true })
          .start(() => onDeleteRef.current?.());
      } else {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
      }
    })
    .onFinalize(() => {
      if (!deletedRef.current) Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
    }), []);

  return (
    <View style={{ overflow: 'hidden' }}>
      <Animated.View style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, left: 0,
        backgroundColor: '#FF3B30', alignItems: 'flex-end', justifyContent: 'center',
        paddingRight: 20, opacity: bgOpacity,
      }}>
        <Ionicons name="trash" size={22} color="#fff" />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={{ transform: [{ translateX: clampedX }], backgroundColor: C.surface }}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

// ── ACTIVE WORKOUT MODAL ──────────────────────────────────
function ActiveWorkoutModal({ workout, setWorkout, onFinish, onSaveRoutine, getPrevious, onMinimize, elapsed, unit = 'kg' }) {
  const C = useContext(ThemeContext);
  const wkStyles = mkWkStyles(C);
  const insets   = useSafeAreaInsets();
  const screenH  = Dimensions.get('window').height;
  const slideY   = useRef(new Animated.Value(screenH)).current;
  const [wUnit,         setWUnit]         = useState(unit);
  const toggleWUnit = () => {
    setWUnit(u => {
      const newU = u === 'kg' ? 'lbs' : 'kg';
      const factor = newU === 'lbs' ? 2.2046 : 1 / 2.2046;
      setWorkout(w => ({
        ...w,
        exercises: w.exercises.map(ex => ({
          ...ex,
          sets: ex.sets.map(s => ({
            ...s,
            weight: s.weight ? String(Math.round(parseFloat(s.weight) * factor * 10) / 10) : s.weight,
          })),
        })),
      }));
      return newU;
    });
  };
  const [showPicker,    setShowPicker]    = useState(false);
  const [finishing,     setFinishing]     = useState(false);
  const [finishElapsed, setFinishElapsed] = useState(0);
  const [showShare,     setShowShare]     = useState(false);
  const [pendingEx,     setPendingEx]     = useState(null);
  const [showPlateCalc, setShowPlateCalc] = useState(false);
  const [show1RM,       setShow1RM]       = useState(false);
  const [restSecs,    setRestSecs]    = useState(0);
  const [restDefault, setRestDefault] = useState(REST_DEFAULT);
  const [activeFocus, setActiveFocus] = useState(null);
  const restActive = restSecs > 0;

  useEffect(() => {
    AsyncStorage.getItem(REST_TIMER_KEY).then(v => { if (v) setRestDefault(Number(v)); });
  }, []);

  useEffect(() => {
    if (!restActive) return;
    const iv = setInterval(() => {
      setRestSecs(s => {
        if (s <= 1) {
          clearInterval(iv);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          Vibration.vibrate([0, 300, 100, 300]);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [restActive]);

  useEffect(() => {
    Animated.spring(slideY, { toValue: 0, tension: 70, friction: 14, useNativeDriver: true }).start();
  }, []);

  const onMinimizeRef = useRef(onMinimize);
  onMinimizeRef.current = onMinimize;

  const swipeDown = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder:  (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
    onPanResponderGrant: () => { slideY.stopAnimation(); },
    onPanResponderMove:  (_, g) => { if (g.dy > 0) slideY.setValue(g.dy); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > screenH * 0.25 || g.vy > 0.5) {
        Animated.timing(slideY, { toValue: screenH, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true })
          .start(() => onMinimizeRef.current());
      } else {
        Animated.spring(slideY, { toValue: 0, tension: 120, friction: 18, useNativeDriver: true }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.spring(slideY, { toValue: 0, tension: 120, friction: 18, useNativeDriver: true }).start();
    },
  })).current;

  const updateEx = (exIdx, fn) =>
    setWorkout(p => ({ ...p, exercises: p.exercises.map((e,i) => i===exIdx ? fn(e) : e) }));

  const updateSet = (exIdx, sIdx, field, val) =>
    updateEx(exIdx, ex => ({ ...ex, sets: ex.sets.map((s,i) => i===sIdx ? {...s,[field]:val} : s) }));

  const toggleSet = (exIdx, sIdx) => {
    const wasCompleted = workout.exercises[exIdx].sets[sIdx].completed;
    updateEx(exIdx, ex => ({ ...ex, sets: ex.sets.map((s,i) => i===sIdx ? {...s, completed:!s.completed} : s) }));
    if (!wasCompleted) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    // rest timer is manual — do not auto-start
  };

  const removeSet = (exIdx, sIdx) =>
    updateEx(exIdx, ex => ({ ...ex, sets: ex.sets.filter((_,i) => i !== sIdx) }));

  const addSet = (exIdx) => {
    const last = workout.exercises[exIdx].sets.slice(-1)[0];
    updateEx(exIdx, ex => ({ ...ex, sets: [...ex.sets, { id:`${Date.now()}${Math.random()}`, weight:last?.weight||'', reps:last?.reps||'', type: last?.type || 'working', completed:false }] }));
  };

  const addExercise = (def) => { confirmAddExercise(def, 1); setShowPicker(false); };

  const confirmAddExercise = (def, n) => {
    const prev = getPrevious(def.id);
    const sets = Array.from({ length: n }, () => newSet());
    setWorkout(p => ({
      ...p,
      exercises: [...p.exercises, {
        id: `${Date.now()}${Math.random()}`,
        exerciseId: def.id, name: def.name, muscle: def.muscle, equipment: def.equipment,
        sets, previous: prev,
      }],
    }));
    setPendingEx(null);
  };

  const removeExercise = (exIdx) =>
    Alert.alert(workout.exercises[exIdx].name, '', [
      { text:'Remove Exercise', style:'destructive', onPress:() => setWorkout(p => ({ ...p, exercises: p.exercises.filter((_,i) => i!==exIdx) })) },
      { text:'Cancel', style:'cancel' },
    ]);

  const confirmCancel = () =>
    Alert.alert('Discard Workout?', 'This workout will not be saved.', [
      { text: 'Keep Going', style:'cancel' },
      { text: 'Discard', style:'destructive', onPress: () => setWorkout(null) },
    ]);

  const completedSets = workout.exercises.flatMap(e => e.sets.filter(s => s.completed && (s.weight||s.reps)));
  const volume        = completedSets.reduce((sum,s) => sum + parseFloat(s.weight||0)*parseInt(s.reps||0), 0);
  const totalSets     = workout.exercises.reduce((s,e) => s + e.sets.length, 0);
  const doneSets      = workout.exercises.reduce((s,e) => s + e.sets.filter(x=>x.completed).length, 0);
  const progressPct   = totalSets > 0 ? doneSets / totalSets : 0;

  const workoutPRs = workout.exercises
    .filter(e => PR_NAMES.includes(e.name))
    .flatMap(e => {
      const prevBest = Math.max(...(e.previous||[]).map(s=>parseFloat(s.weight)||0), 0);
      const thisBest = Math.max(...e.sets.filter(s=>s.completed).map(s=>parseFloat(s.weight)||0), 0);
      return thisBest > prevBest && thisBest > 0 ? [{ name:e.name, weight:thisBest }] : [];
    });

  const handleFinish = () => {
    if (completedSets.length === 0) {
      Alert.alert('No sets logged', 'Complete at least one set before finishing.', [
        { text:'Keep Going', style:'cancel' },
        { text:'Discard', style:'destructive', onPress:() => setWorkout(null) },
      ]);
      return;
    }
    setFinishElapsed(elapsed);
    setFinishing(true);
  };

  return (
    <Animated.View
      style={[StyleSheet.absoluteFillObject, { backgroundColor:C.bg, zIndex:100, paddingTop:insets.top, transform:[{translateY:slideY}] }]}>
      <StatusBar barStyle={C.statusBar} />

      {finishing ? (
        /* ── FINISH SUMMARY ── */
        <>
        <ScrollView contentContainerStyle={{ flexGrow:1, justifyContent:'center', padding:28 }}>
          {/* Trophy + title */}
          <View style={{ alignItems:'center', marginBottom:28 }}>
            <View style={{ width:80, height:80, borderRadius:40, backgroundColor:'rgba(255,179,64,0.15)',
              alignItems:'center', justifyContent:'center', marginBottom:16 }}>
              <Ionicons name="trophy" size={40} color="#FFB340" />
            </View>
            <Text style={{ fontSize:11, fontWeight:'700', color:C.accent, letterSpacing:2, marginBottom:6 }}>WORKOUT COMPLETE</Text>
            <Text style={{ fontSize:28, fontWeight:'900', color:C.t1, letterSpacing:-0.5, textAlign:'center' }}>{workout.name}</Text>
          </View>

          {/* Stats */}
          <View style={{ flexDirection:'row', backgroundColor:C.surface, borderRadius:18, marginBottom:16, overflow:'hidden' }}>
            {[
              { val: fmtTimer(finishElapsed),             lbl:'DURATION'   },
              { val: Math.round(volume).toLocaleString(), lbl:'VOLUME KG'  },
              { val: String(completedSets.length),        lbl:'SETS'       },
            ].map((s, i) => (
              <View key={s.lbl} style={{ flex:1, alignItems:'center', paddingVertical:20,
                borderLeftWidth: i > 0 ? 1 : 0, borderLeftColor: C.border }}>
                <Text style={{ fontSize:24, fontWeight:'900', color:C.t1, letterSpacing:-0.5 }}>{s.val}</Text>
                <Text style={{ fontSize:10, fontWeight:'700', color:C.t3, letterSpacing:1, marginTop:4 }}>{s.lbl}</Text>
              </View>
            ))}
          </View>

          {/* PR badges */}
          {workoutPRs.length > 0 && (
            <View style={{ backgroundColor:'rgba(255,214,10,0.08)', borderRadius:14, padding:16, marginBottom:16, borderWidth:1, borderColor:'rgba(255,214,10,0.2)' }}>
              <Text style={{ fontSize:11, fontWeight:'700', color:'#FFD60A', letterSpacing:1.5, marginBottom:10 }}>🏅 PERSONAL RECORDS</Text>
              {workoutPRs.map(pr => (
                <View key={pr.name} style={{ flexDirection:'row', justifyContent:'space-between', marginBottom:4 }}>
                  <Text style={{ fontSize:14, fontWeight:'600', color:C.t1 }}>{pr.name}</Text>
                  <Text style={{ fontSize:14, fontWeight:'800', color:'#FFD60A' }}>{pr.weight} kg</Text>
                </View>
              ))}
            </View>
          )}

          {/* Actions */}
          <View style={{ gap:10 }}>
            <TouchableOpacity style={[wkStyles.finishBtn, { paddingVertical:17 }]} activeOpacity={0.85} onPress={() => onFinish(workout)}>
              <Text style={wkStyles.finishBtnText}>Done</Text>
            </TouchableOpacity>
            {!workout.fromRoutine && (
              <TouchableOpacity activeOpacity={0.8}
                onPress={() => {
                  Alert.alert('Save as Routine?', 'Add this workout as a reusable routine?', [
                    { text: 'Save Routine', onPress: () => onSaveRoutine?.({
                        name: workout.name,
                        exercises: workout.exercises.map(e => ({ exerciseId: e.exerciseId, name: e.name, muscle: e.muscle }))
                      })
                    },
                    { text: 'Not now', style: 'cancel' },
                  ]);
                }}
                style={{ borderRadius:14, paddingVertical:13, alignItems:'center', justifyContent:'center',
                  flexDirection:'row', gap:8, backgroundColor:C.surface }}>
                <Ionicons name="bookmark-outline" size={16} color={C.t2} />
                <Text style={{ color:C.t2, fontSize:14, fontWeight:'600' }}>Save as Routine</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity activeOpacity={0.8} onPress={() => setShowShare(true)}
              style={{ borderRadius:14, paddingVertical:13, alignItems:'center', justifyContent:'center',
                flexDirection:'row', gap:8, backgroundColor:C.surface }}>
              <Ionicons name="share-social" size={16} color={C.t2} />
              <Text style={{ color:C.t2, fontSize:14, fontWeight:'600' }}>Share Workout</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => setFinishing(false)} style={{ marginTop:20, alignItems:'center' }}>
            <Text style={{ color:C.t3, fontSize:14 }}>Back</Text>
          </TouchableOpacity>
        </ScrollView>

        <WorkoutShareModal
          visible={showShare}
          onClose={() => setShowShare(false)}
          workout={{
            name: workout.name,
            date: new Date().toISOString(),
            duration: elapsed,
            volume: Math.round(volume),
            exercises: workout.exercises
              .filter(e => e.sets.some(s => s.completed && (s.weight || s.reps)))
              .map(e => ({ name: e.name, muscle: e.muscle || '', sets: e.sets.filter(s => s.completed) })),
          }}
        />
        </>
      ) : (
        <>
          {/* ── HEADER ── */}
          <View {...swipeDown.panHandlers}>
            {/* Progress bar */}
            <View style={{ height:3, backgroundColor:C.s2 }}>
              <View style={{ height:3, width:`${progressPct*100}%`, backgroundColor:C.accent, borderRadius:2 }} />
            </View>
            <View style={wkStyles.activeHeader}>
              <TouchableOpacity onPress={confirmCancel} hitSlop={8}>
                <Ionicons name="close" size={24} color={C.t1} />
              </TouchableOpacity>
              <View style={{ alignItems:'center' }}>
                <View style={{ width:36, height:4, borderRadius:2, backgroundColor:C.s3, marginBottom:4 }} />
                <Text style={wkStyles.activeName}>{workout.name}</Text>
                <View style={{ flexDirection:'row', alignItems:'center', gap:8, marginTop:2 }}>
                  <Text style={wkStyles.activeTimer}>{fmtTimer(elapsed)}</Text>
                  {volume > 0 && (
                    <>
                      <Text style={{ color:C.s3, fontSize:12 }}>·</Text>
                      <Text style={{ fontSize:12, color:C.t3, fontWeight:'600' }}>{Math.round(volume).toLocaleString()} kg</Text>
                    </>
                  )}
                  {doneSets > 0 && (
                    <>
                      <Text style={{ color:C.s3, fontSize:12 }}>·</Text>
                      <Text style={{ fontSize:12, color:C.t3, fontWeight:'600' }}>{doneSets}/{totalSets} sets</Text>
                    </>
                  )}
                </View>
              </View>
              <TouchableOpacity style={wkStyles.finishSmallBtn} onPress={handleFinish}>
                <Text style={wkStyles.finishSmallBtnText}>Finish</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── UTILITY ROW ── */}
          <View style={{ flexDirection:'row', paddingHorizontal:16, paddingVertical:8, gap:8 }}>
            <TouchableOpacity
              onPress={() => setShowPlateCalc(true)}
              style={{ flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center',
                gap:6, backgroundColor:C.s2, borderRadius:20, paddingVertical:9 }}
            >
              <Ionicons name="barbell-outline" size={15} color={C.accent} />
              <Text style={{ fontSize:13, fontWeight:'600', color:C.accent }}>Plates</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShow1RM(true)}
              style={{ flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center',
                gap:6, backgroundColor:C.s2, borderRadius:20, paddingVertical:9 }}
            >
              <Ionicons name="trophy-outline" size={15} color={C.accent} />
              <Text style={{ fontSize:13, fontWeight:'600', color:C.accent }}>1RM</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => restActive ? setRestSecs(0) : setRestSecs(restDefault)}
              style={{ flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center',
                gap:6, backgroundColor: restActive ? C.accent : C.s2,
                borderRadius:20, paddingVertical:9 }}
            >
              <Ionicons name={restActive ? 'stop-circle-outline' : 'timer-outline'} size={15}
                color={restActive ? '#fff' : C.accent} />
              <Text style={{ fontSize:13, fontWeight:'600', color: restActive ? '#fff' : C.accent }}>
                {restActive ? fmtTimer(restSecs) : `Rest ${fmtTimer(restDefault)}`}
              </Text>
            </TouchableOpacity>
          </View>

          {restSecs > 0 && (
            <View style={{ marginHorizontal:16, marginBottom:8, backgroundColor:C.surface,
              borderRadius:14, paddingHorizontal:14, paddingVertical:10,
              borderWidth:1, borderColor: restSecs <= 10 ? '#FF375F' : C.accent + '55' }}>
              <View style={{ height:2, backgroundColor:C.s2, borderRadius:2, marginBottom:8, overflow:'hidden' }}>
                <View style={{ height:2, borderRadius:2,
                  width:`${(restSecs / restDefault) * 100}%`,
                  backgroundColor: restSecs <= 10 ? '#FF375F' : C.accent }} />
              </View>
              <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}>
                <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                  <Ionicons name="timer-outline" size={14} color={restSecs <= 10 ? '#FF375F' : C.accent} />
                  <Text style={{ fontSize:22, fontWeight:'800', letterSpacing:-0.5,
                    color: restSecs <= 10 ? '#FF375F' : C.accent }}>
                    {fmtTimer(restSecs)}
                  </Text>
                </View>
                <View style={{ flexDirection:'row', gap:6 }}>
                  <TouchableOpacity onPress={() => setRestSecs(s => s + 30)}
                    style={{ backgroundColor:C.s2, borderRadius:8, paddingHorizontal:12, paddingVertical:6 }}>
                    <Text style={{ color:C.t1, fontSize:13, fontWeight:'700' }}>+30s</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setRestSecs(0)}
                    style={{ backgroundColor:C.accent, borderRadius:8, paddingHorizontal:14, paddingVertical:6 }}>
                    <Text style={{ color:'#fff', fontSize:13, fontWeight:'700' }}>Done</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}

          {/* ── EXERCISES ── */}
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingTop:12, paddingBottom:120 }}>
            {workout.exercises.length === 0 && (
              <View style={{ alignItems:'center', paddingTop:60, paddingBottom:20 }}>
                <View style={{ width:72, height:72, borderRadius:36, backgroundColor:C.surface,
                  alignItems:'center', justifyContent:'center', marginBottom:16 }}>
                  <Ionicons name="barbell-outline" size={32} color={C.accent} />
                </View>
                <Text style={{ fontSize:18, fontWeight:'700', color:C.t1, marginBottom:6 }}>Ready to train</Text>
                <Text style={{ fontSize:14, color:C.t3, textAlign:'center', paddingHorizontal:40 }}>
                  Add your first exercise to get started
                </Text>
              </View>
            )}

            {workout.exercises.map((ex, exIdx) => {
              const exDone   = ex.sets.filter(s=>s.completed).length;
              const exTotal  = ex.sets.length;
              const allDone  = exDone === exTotal && exTotal > 0;
              const muscleColor = MUSCLE_META[ex.muscle]?.color || C.accent;
              return (
              <View key={ex.id} style={[wkStyles.exCard, { borderLeftWidth:3, borderLeftColor: allDone ? '#30D158' : muscleColor }]}>
                <View style={wkStyles.exHeader}>
                  <View style={{ flex:1 }}>
                    <Text style={wkStyles.exName}>{ex.name}</Text>
                    <Text style={wkStyles.exMeta}>{ex.muscle} · {ex.equipment}</Text>
                  </View>
                  <View style={{ flexDirection:'row', alignItems:'center', gap:10 }}>
                    <View style={{ backgroundColor: allDone ? 'rgba(48,209,88,0.15)' : C.s2,
                      borderRadius:20, paddingHorizontal:10, paddingVertical:4 }}>
                      <Text style={{ fontSize:12, fontWeight:'700', color: allDone ? '#30D158' : C.t3 }}>
                        {exDone}/{exTotal}
                      </Text>
                    </View>
                    <TouchableOpacity hitSlop={10} onPress={() => removeExercise(exIdx)}>
                      <Ionicons name="ellipsis-horizontal" size={20} color={C.t3} />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={wkStyles.setHeader}>
                  <Text style={[wkStyles.setHeaderCell, { width:28 }]}>SET</Text>
                  <Text style={[wkStyles.setHeaderCell, { flex:1 }]}>PREVIOUS</Text>
                  <TouchableOpacity onPress={toggleWUnit}
                    style={{ width:58, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:3 }}>
                    <Text style={[wkStyles.setHeaderCell, { textAlign:'center', color: C.accent }]}>{wUnit.toUpperCase()}</Text>
                    <Ionicons name="swap-horizontal" size={10} color={C.accent} />
                  </TouchableOpacity>
                  <Text style={[wkStyles.setHeaderCell, { width:52, textAlign:'center' }]}>REPS</Text>
                  <Text style={[wkStyles.setHeaderCell, { width:44, textAlign:'center' }]}>RPE</Text>
                  <Text style={[wkStyles.setHeaderCell, { width:38 }]}> </Text>
                </View>

                {ex.sets.map((s, sIdx) => {
                  const prev    = ex.previous?.[sIdx];
                  const prevTxt = prev ? `${prev.weight} × ${prev.reps}` : '—';
                  return (
                    <SwipeableSetRow key={s.id} onDelete={() => removeSet(exIdx, sIdx)}>
                      {(() => {
                        const focusKey = `${exIdx}-${sIdx}`;
                        const isFocused = activeFocus === focusKey;
                        return (
                          <View style={[wkStyles.setRow, s.completed && wkStyles.setRowDone,
                            isFocused && { backgroundColor: C.accent + '12' }]}>
                            <TouchableOpacity hitSlop={8}
                              onPress={() => updateSet(exIdx, sIdx, 'type', s.type === 'warmup' ? 'working' : 'warmup')}
                              onLongPress={() => Alert.alert('Remove Set', `Remove set ${sIdx+1}?`, [
                                { text: 'Remove', style: 'destructive', onPress: () => removeSet(exIdx, sIdx) },
                                { text: 'Cancel', style: 'cancel' },
                              ])}>
                              <Text style={[wkStyles.setNum,
                                s.type === 'warmup' && { color: '#FF9F0A' },
                                isFocused && { color: C.accent }]}>
                                {s.type === 'warmup' ? 'W' : sIdx+1}
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={{ flex:1, justifyContent:'center' }} activeOpacity={prev ? 0.5 : 1}
                              onPress={() => {
                                if (!prev) return;
                                updateSet(exIdx, sIdx, 'weight', String(prev.weight));
                                updateSet(exIdx, sIdx, 'reps',   String(prev.reps));
                              }}>
                              <Text style={{ fontSize:12, color: prev ? C.t1 : C.t3, fontWeight: prev ? '700' : '400' }}>
                                {prevTxt}
                              </Text>
                            </TouchableOpacity>
                            <TextInput
                              style={[wkStyles.setInput, { width:58 }, isFocused && { borderColor: C.accent, borderWidth: 1 }]}
                              value={s.weight}
                              onChangeText={v => updateSet(exIdx, sIdx, 'weight', v)}
                              keyboardType="decimal-pad"
                              placeholder={prev?.weight || '0'}
                              placeholderTextColor={C.t3}
                              selectTextOnFocus
                              onFocus={() => setActiveFocus(focusKey)}
                              onBlur={() => setActiveFocus(null)}
                            />
                            <TextInput
                              style={[wkStyles.setInput, { width:52 }, isFocused && { borderColor: C.accent, borderWidth: 1 }]}
                              value={s.reps}
                              onChangeText={v => updateSet(exIdx, sIdx, 'reps', v)}
                              keyboardType="number-pad"
                              placeholder={prev?.reps || '0'}
                              placeholderTextColor={C.t3}
                              selectTextOnFocus
                              onFocus={() => setActiveFocus(focusKey)}
                              onBlur={() => setActiveFocus(null)}
                            />
                            <TextInput
                              style={[wkStyles.setInput, { width:44, color: s.rpe ? C.accent : C.t3 }]}
                              value={s.rpe}
                              onChangeText={v => updateSet(exIdx, sIdx, 'rpe', v)}
                              keyboardType="decimal-pad"
                              placeholder="—"
                              placeholderTextColor={C.s3}
                              selectTextOnFocus
                              maxLength={4}
                              onFocus={() => setActiveFocus(focusKey)}
                              onBlur={() => setActiveFocus(null)}
                            />
                            <TouchableOpacity
                              style={[wkStyles.setCheck, s.completed && wkStyles.setCheckDone,
                                { width:38, height:38, borderRadius:10 }]}
                              onPress={() => toggleSet(exIdx, sIdx)}
                              hitSlop={6}
                            >
                              <Ionicons name={s.completed ? 'checkmark' : 'checkmark-outline'} size={20} color={s.completed ? '#fff' : C.s3} />
                            </TouchableOpacity>
                          </View>
                        );
                      })()}
                    </SwipeableSetRow>
                  );
                })}

                <TouchableOpacity style={wkStyles.addSetBtn} onPress={() => addSet(exIdx)}>
                  <Text style={wkStyles.addSetText}>+ Add Set</Text>
                </TouchableOpacity>

                <View style={{ flexDirection:'row', alignItems:'center', paddingHorizontal:14, paddingBottom:10, gap:6 }}>
                  <Ionicons name="create-outline" size={14} color={C.t3} />
                  <TextInput
                    style={{ flex:1, color:C.t2, fontSize:13, paddingVertical:4 }}
                    value={ex.note || ''}
                    onChangeText={v => updateEx(exIdx, ex => ({ ...ex, note: v }))}
                    placeholder="Add a note…"
                    placeholderTextColor={C.s3}
                    multiline
                  />
                </View>
              </View>
              );
            })}

            <TouchableOpacity style={wkStyles.addExBtn} onPress={() => setShowPicker(true)}>
              <Ionicons name="add-circle-outline" size={20} color={C.accent} />
              <Text style={wkStyles.addExText}>Add Exercise</Text>
            </TouchableOpacity>
          </ScrollView>
        </>
      )}

      <ExercisePickerModal visible={showPicker} onClose={() => setShowPicker(false)} onSelect={addExercise} />

      {pendingEx && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setPendingEx(null)}>
          <TouchableOpacity style={{ flex:1, backgroundColor:'rgba(0,0,0,0.55)' }} activeOpacity={1} onPress={() => setPendingEx(null)} />
          <View style={{ backgroundColor:C.surface, borderTopLeftRadius:22, borderTopRightRadius:22, padding:24, paddingBottom:48 }}>
            <Text style={{ fontSize:17, fontWeight:'700', color:C.t1, marginBottom:4 }}>How many sets?</Text>
            <Text style={{ fontSize:13, color:C.t3, marginBottom:20 }}>{pendingEx.name}</Text>
            <View style={{ flexDirection:'row', gap:8 }}>
              {[1,2,3,4,5,6,7].map(n => (
                <TouchableOpacity key={n}
                  style={{ flex:1, backgroundColor:C.s2, borderRadius:10, paddingVertical:14, alignItems:'center' }}
                  onPress={() => confirmAddExercise(pendingEx, n)}
                >
                  <Text style={{ color:C.t1, fontSize:17, fontWeight:'700' }}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity onPress={() => setPendingEx(null)} style={{ marginTop:18, alignItems:'center' }}>
              <Text style={{ color:C.t3, fontSize:14 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}
      <PlateCalculatorModal visible={showPlateCalc} onClose={() => setShowPlateCalc(false)} />
      <OneRMModal visible={show1RM} onClose={() => setShow1RM(false)} />
    </Animated.View>
  );
}

// ── WORKOUT SCREEN ────────────────────────────────────────
function WorkoutScreen() {
  const insets = useSafeAreaInsets();
  const C = useContext(ThemeContext);
  const styles = mkStyles(C);
  const wkStyles = mkWkStyles(C);
  const [routines,        setRoutines]        = useState([]);
  const [history,         setHistory]         = useState([]);
  const [activeWorkout,   setActiveWorkout]   = useState(null);
  const [minimized,       setMinimized]       = useState(false);
  const [elapsed,         setElapsed]         = useState(0);
  const [showLibrary,     setShowLibrary]     = useState(false);
  const [buildingRoutine, setBuildingRoutine] = useState(null);
  const [weightUnit,      setWeightUnit]      = useState('kg');
  const [shareTarget,     setShareTarget]     = useState(null);
  const [showPlateCalc,   setShowPlateCalc]   = useState(false);
  const [showCardioLog,   setShowCardioLog]   = useState(false);
  const [screenReady,     setScreenReady]     = useState(false);
  const [recentCollapsed, setRecentCollapsed] = useState(false);
  const [wkToastMsg,      setWkToastMsg]      = useState('');
  const [undoRoutine,     setUndoRoutine]     = useState(null);
  const wkToastOpacity    = useRef(new Animated.Value(0)).current;
  const wkToastY          = useRef(new Animated.Value(8)).current;
  const wkToastTimer      = useRef(null);

  const showWkToast = useCallback((msg, undo = null) => {
    clearTimeout(wkToastTimer.current);
    setWkToastMsg(msg);
    setUndoRoutine(undo);
    wkToastOpacity.setValue(0);
    wkToastY.setValue(8);
    Animated.parallel([
      Animated.timing(wkToastOpacity, { toValue: 1, duration: 140, useNativeDriver: true }),
      Animated.timing(wkToastY, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]).start();
    wkToastTimer.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(wkToastOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(wkToastY, { toValue: 8, duration: 220, useNativeDriver: true }),
      ]).start(() => setUndoRoutine(null));
    }, undo ? 4000 : 2000);
  }, []);

  useEffect(() => () => clearTimeout(wkToastTimer.current), []);

  useFocusEffect(useCallback(() => { reload(); }, []));

  useEffect(() => {
    AsyncStorage.getItem(UNITS_KEY).then(u => { if (u) setWeightUnit(u); });
  }, []);

  useEffect(() => {
    if (!activeWorkout) { setElapsed(0); setMinimized(false); return; }
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - activeWorkout.startTime) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [activeWorkout?.startTime]);

  const reload = useCallback(async () => {
    const [r, h] = await Promise.all([
      AsyncStorage.getItem(ROUTINES_KEY),
      AsyncStorage.getItem(WORKOUTS_KEY),
    ]);
    setRoutines(parseStoredJson(r, []));
    setHistory(parseStoredJson(h, []));
    setScreenReady(true);
  }, []);

  const getPrevious = useCallback((exerciseId) => {
    for (const w of history) {
      const ex = w.exercises?.find(e => e.exerciseId === exerciseId);
      if (ex?.sets?.length) return ex.sets;
    }
    return null;
  }, [history]);

  const startWorkout = useCallback((routine = null) => {
    const exercises = routine
      ? routine.exercises.map(e => {
          const def = EXERCISE_DB.find(x => x.id === e.exerciseId) || { id:e.exerciseId, name:e.name, muscle:e.muscle||'', equipment:'' };
          const prev = getPrevious(def.id);
          return { id:`${Date.now()}${Math.random()}`, exerciseId:def.id, name:def.name, muscle:def.muscle, equipment:def.equipment, sets:[newSet(),newSet(),newSet()], previous:prev };
        })
      : [];
    setActiveWorkout({ id:`${Date.now()}`, name:routine?.name||'Workout', startTime:Date.now(), exercises, fromRoutine: !!routine });
  }, [getPrevious]);

  const finishWorkout = useCallback(async (workout) => {
    const duration = Math.round((Date.now() - workout.startTime) / 1000);
    const allSets  = workout.exercises.flatMap(e => e.sets.filter(s => s.completed));
    const volume   = Math.round(allSets.reduce((sum,s) => sum + parseFloat(s.weight||0)*parseInt(s.reps||0), 0));
    const saved    = {
      id: workout.id, name: workout.name,
      date: new Date().toISOString(), duration, volume,
      exercises: workout.exercises
        .map(e => ({ exerciseId:e.exerciseId, name:e.name, muscle:e.muscle||'', note:e.note||'', sets:e.sets.filter(s=>s.completed).map(s=>({ weight:s.weight, reps:s.reps, rpe:s.rpe||'' })) }))
        .filter(e => e.sets.length > 0),
    };
    const existing = await getJson(WORKOUTS_KEY, []);
    const updated  = [saved, ...existing].slice(0, 100);
    await AsyncStorage.setItem(WORKOUTS_KEY, JSON.stringify(updated));
    setHistory(updated);
    setActiveWorkout(null);
  }, []);

  const saveRoutine = useCallback(async (routine) => {
    setRoutines(prev => {
      const updated = routine.id
        ? prev.map(r => r.id === routine.id ? routine : r)
        : [...prev, { ...routine, id:`${Date.now()}` }];
      AsyncStorage.setItem(ROUTINES_KEY, JSON.stringify(updated));
      return updated;
    });
    setBuildingRoutine(null);
  }, []);

  const deleteRoutine = useCallback((id) =>
    Alert.alert('Delete Routine', 'This cannot be undone.', [
      { text:'Cancel', style:'cancel' },
      { text:'Delete', style:'destructive', onPress: () => {
        setRoutines(prev => {
          const updated = prev.filter(r => r.id !== id);
          AsyncStorage.setItem(ROUTINES_KEY, JSON.stringify(updated));
          return updated;
        });
      }},
    ]), []);

  const deleteRoutineDirect = useCallback((id) => {
    setRoutines(prev => {
      const target = prev.find(r => r.id === id);
      const idx = prev.indexOf(target);
      const updated = prev.filter(r => r.id !== id);
      AsyncStorage.setItem(ROUTINES_KEY, JSON.stringify(updated));
      if (target) showWkToast('Routine deleted', { routine: target, idx });
      return updated;
    });
  }, [showWkToast]);

  const addToActiveWorkout = useCallback((def, n) => {
    const prev = getPrevious(def.id);
    const sets = Array.from({ length: n }, () => newSet());
    setActiveWorkout(p => ({
      ...p,
      exercises: [...p.exercises, {
        id: `${Date.now()}${Math.random()}`,
        exerciseId: def.id, name: def.name, muscle: def.muscle, equipment: def.equipment,
        sets, previous: prev,
      }],
    }));
    setShowLibrary(false);
    setMinimized(false);
  }, [getPrevious]);

  // ── derived values for UI ──
  const lastTrainedLabel = useMemo(() => {
    const lw = history[0];
    if (!lw) return 'No workouts yet';
    const d = Math.floor((Date.now() - new Date(lw.date).getTime()) / 86400000);
    if (d === 0) return 'Trained today';
    if (d === 1) return 'Last trained yesterday';
    return `Last trained ${d} days ago`;
  }, [history]);

  // Week strip — which calendar days (Mon–Sun) had a workout
  const weekDays = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    const dow = (today.getDay() + 6) % 7; // 0=Mon
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today); d.setDate(today.getDate() - dow + i);
      const label = ['M','T','W','T','F','S','S'][i];
      const trained = history.some(w => {
        const wd = new Date(w.date); wd.setHours(0,0,0,0);
        return wd.getTime() === d.getTime();
      });
      const isToday = d.getTime() === today.getTime();
      return { label, trained, isToday };
    });
  }, [history]);

  // Average volume for trend bar
  const avgVolume = useMemo(() =>
    history.length
      ? history.slice(0, 10).reduce((s, w) => s + (w.volume || 0), 0) / Math.min(history.length, 10)
      : 0,
  [history]);

  // Streak — consecutive days with at least one workout (today counts if trained)
  const streak = useMemo(() => {
    let s = 0;
    const today = new Date(); today.setHours(0,0,0,0);
    for (let i = 0; i < 365; i++) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const dStr = d.toISOString().split('T')[0];
      if (history.some(w => w.date?.startsWith(dStr))) { s++; } else if (i > 0) break;
    }
    return s;
  }, [history]);

  // Hero copy — dynamic based on training state
  const heroContext = useMemo(() => {
    const lw = history[0];
    if (!lw) return { headline: 'Start your first workout', sub: 'Log sets, track PRs, build the habit.', cta: 'Let\'s go' };
    const daysSince = Math.floor((Date.now() - new Date(lw.date).getTime()) / 86400000);
    if (daysSince === 0) return { headline: 'Trained today 💪', sub: `${lw.name} — well done. Come back if you want more.`, cta: 'Train again' };
    if (daysSince === 1) return { headline: 'Ready for another?', sub: `${lw.name} was yesterday. Keep the streak alive.`, cta: 'Let\'s go' };
    if (daysSince === 2) return { headline: 'Two days off.', sub: 'Muscles are recovered. Time to get back in.', cta: 'Start now' };
    return { headline: `${daysSince} days since your last session.`, sub: `Last: ${lw.name}. The gym misses you.`, cta: 'Get back in' };
  }, [history]);

  // PR detection — did this workout set any big-lift PR
  const prMap = useMemo(() => {
    const bests = {};
    const prWorkouts = new Set();
    // oldest first so we mark the first time a PR is set
    for (let i = history.length - 1; i >= 0; i--) {
      const w = history[i];
      for (const ex of (w.exercises || [])) {
        if (!ex.name) continue;
        const best = Math.max(...(ex.sets || []).filter(s => s.type !== 'warmup').map(s => parseFloat(s.weight) || 0));
        if (best > 0 && (!bests[ex.name] || best > bests[ex.name])) {
          bests[ex.name] = best;
          prWorkouts.add(w.id);
        }
      }
    }
    return prWorkouts;
  }, [history]);

  return (
    <View style={[styles.screen, { paddingTop:insets.top, backgroundColor: C.bg }]}>
      <StatusBar barStyle={C.statusBar} />

      {/* ── HEADER ── */}
      <View style={[wkStyles.header, { paddingBottom: 10 }]}>
        <View>
          <Text style={wkStyles.title}>Workout</Text>
          <Text style={{ fontSize: 13, color: C.t3, fontWeight: '500', marginTop: 1 }}>{lastTrainedLabel}</Text>
        </View>
        <View style={{ flexDirection:'row', alignItems:'center', gap:18 }}>
          <TouchableOpacity onPress={() => setShowPlateCalc(true)}>
            <Ionicons name="barbell-outline" size={22} color={C.accent} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowLibrary(true)}>
            <Text style={wkStyles.historyBtn}>Library</Text>
          </TouchableOpacity>
        </View>
      </View>

      {!screenReady ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
          {[1,2,3].map(i => (
            <View key={i} style={{ marginHorizontal:16, marginBottom:14, borderRadius:14, backgroundColor:'rgba(255,255,255,0.06)', height: i === 1 ? 110 : 72, overflow:'hidden' }}>
              <SkeletonShimmer />
            </View>
          ))}
        </ScrollView>
      ) : (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom:40 }}>

        {/* ── HERO CARD ── */}
        <View style={{ marginHorizontal:16, marginBottom:16, borderRadius:20, overflow:'hidden', backgroundColor: C.surface }}>
          <View style={{ backgroundColor: C.accent, position:'absolute', top:0, left:0, right:0, height:3 }} />
          <View style={{ padding:20, paddingTop:24 }}>
            <Text style={{ fontSize:22, fontWeight:'900', color:C.t1, letterSpacing:-0.5, marginBottom:6 }}>
              {heroContext.headline}
            </Text>
            <Text style={{ fontSize:13, color:C.t2, lineHeight:19, marginBottom:20 }}>
              {heroContext.sub}
            </Text>
            <View style={{ flexDirection:'row', gap:10 }}>
              <TouchableOpacity activeOpacity={0.85} onPress={() => startWorkout()}
                style={{ flex:2, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8,
                  backgroundColor:C.accent, borderRadius:14, paddingVertical:12 }}>
                <Ionicons name="barbell-outline" size={16} color="#fff" />
                <Text style={{ fontSize:14, fontWeight:'700', color:'#fff' }}>{heroContext.cta}</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.85} onPress={() => setShowCardioLog(true)}
                style={{ flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:6,
                  backgroundColor:'#30D15818', borderRadius:14, paddingVertical:12 }}>
                <Ionicons name="fitness-outline" size={15} color="#30D158" />
                <Text style={{ fontSize:13, fontWeight:'700', color:'#30D158' }}>Cardio</Text>
              </TouchableOpacity>
              {streak > 0 && (
                <View style={{ flexDirection:'row', alignItems:'center', gap:5,
                  backgroundColor: C.s2, borderRadius:14, paddingHorizontal:12, paddingVertical:8 }}>
                  <Text style={{ fontSize:15 }}>🔥</Text>
                  <Text style={{ fontSize:14, fontWeight:'800', color:C.t1 }}>{streak}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* ── QUICK STATS ROW ── */}
        {history.length > 0 && (
          <View style={{ flexDirection:'row', marginHorizontal:16, marginBottom:16, gap:10 }}>
            <View style={{ flex:1, backgroundColor:C.surface, borderRadius:14, padding:14, alignItems:'center' }}>
              <Text style={{ fontSize:22, fontWeight:'900', color:C.t1 }}>{history.length}</Text>
              <Text style={{ fontSize:11, fontWeight:'600', color:C.t3, marginTop:2, letterSpacing:0.3 }}>WORKOUTS</Text>
            </View>
            <View style={{ flex:1, backgroundColor:C.surface, borderRadius:14, padding:14, alignItems:'center' }}>
              <Text style={{ fontSize:22, fontWeight:'900', color:C.t1 }}>
                {weekDays.filter(d => d.trained).length}
              </Text>
              <Text style={{ fontSize:11, fontWeight:'600', color:C.t3, marginTop:2, letterSpacing:0.3 }}>THIS WEEK</Text>
            </View>
            <View style={{ flex:1, backgroundColor:C.surface, borderRadius:14, padding:14, alignItems:'center' }}>
              <Text style={{ fontSize:22, fontWeight:'900', color: streak > 0 ? '#FF9F0A' : C.t1 }}>{streak}</Text>
              <Text style={{ fontSize:11, fontWeight:'600', color:C.t3, marginTop:2, letterSpacing:0.3 }}>STREAK</Text>
            </View>
          </View>
        )}

        {/* ── THIS WEEK STRIP ── */}
        <View style={{ marginHorizontal:16, marginBottom:22, backgroundColor:C.surface, borderRadius:16, padding:16 }}>
          <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
            <Text style={{ fontSize:11, fontWeight:'700', color:C.t3, letterSpacing:1.2 }}>THIS WEEK</Text>
            <Text style={{ fontSize:11, fontWeight:'600', color:C.t3 }}>
              {weekDays.filter(d => d.trained).length}/{weekDays.filter(d => !d.isToday || d.trained).length} days
            </Text>
          </View>
          <View style={{ flexDirection:'row', justifyContent:'space-between' }}>
            {weekDays.map((d, i) => (
              <View key={i} style={{ alignItems:'center', gap:7 }}>
                <View style={{
                  width:36, height:36, borderRadius:18,
                  backgroundColor: d.trained ? C.accent : d.isToday ? C.s2 : 'transparent',
                  borderWidth: d.isToday && !d.trained ? 1.5 : 0,
                  borderColor: C.accent,
                  alignItems:'center', justifyContent:'center',
                }}>
                  {d.trained
                    ? <Ionicons name="checkmark" size={18} color="#fff" />
                    : d.isToday
                      ? <View style={{ width:6, height:6, borderRadius:3, backgroundColor:C.accent }} />
                      : null
                  }
                </View>
                <Text style={{ fontSize:11, fontWeight:'700', color: d.isToday ? C.accent : C.t3 }}>{d.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── MY ROUTINES ── */}
        <View style={wkStyles.sectionRow}>
          <Text style={wkStyles.sectionTitle}>My Routines</Text>
          <TouchableOpacity onPress={() => setBuildingRoutine({ name:'', exercises:[] })}>
            <Text style={wkStyles.sectionAction}>+ New</Text>
          </TouchableOpacity>
        </View>

        {routines.length === 0 && (
          <View style={wkStyles.emptyBox}>
            <Text style={wkStyles.emptyText}>No routines yet. Tap + New to create one.</Text>
          </View>
        )}
        {routines.map(r => {
          const primaryMuscle = r.exercises[0]?.muscle;
          const accentColor   = MUSCLE_META[primaryMuscle]?.color || C.accent;
          const muscles       = [...new Set(r.exercises.map(e => e.muscle).filter(Boolean))];
          const estMins       = Math.round(r.exercises.length * 3.5);
          return (
            <View key={r.id} style={{ marginHorizontal:16, marginBottom:10, borderRadius:14, overflow:'hidden' }}>
              <SwipeableRow onDelete={() => deleteRoutineDirect(r.id)}>
                <TouchableOpacity activeOpacity={0.75} onLongPress={() => deleteRoutine(r.id)}
                  style={{ backgroundColor:C.surface, flexDirection:'row', alignItems:'center' }}>
                  <View style={{ width:4, alignSelf:'stretch', backgroundColor:accentColor }} />
                  <View style={{ flex:1, padding:14, paddingLeft:14 }}>
                    <Text style={{ fontSize:16, fontWeight:'700', color:C.t1, marginBottom:3 }}>{r.name}</Text>
                    <Text style={{ fontSize:12, color:C.t3, marginBottom:8 }} numberOfLines={1}>
                      {r.exercises.slice(0,3).map(e=>e.name).join(' · ')}{r.exercises.length>3?` +${r.exercises.length-3}`:''}
                    </Text>
                    <View style={{ flexDirection:'row', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                      <Text style={{ fontSize:12, color:C.t3 }}>{r.exercises.length} exercises</Text>
                      <Text style={{ fontSize:12, color:C.t3 }}>~{estMins} min</Text>
                      <View style={{ flexDirection:'row', gap:4 }}>
                        {muscles.slice(0,3).map(m => (
                          <View key={m} style={{ backgroundColor: (MUSCLE_META[m]?.color || C.accent) + '22',
                            borderRadius:6, paddingHorizontal:6, paddingVertical:2 }}>
                            <Text style={{ fontSize:10, fontWeight:'700', color: MUSCLE_META[m]?.color || C.accent }}>{m}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => startWorkout(r)} activeOpacity={0.75} style={{ paddingRight:16 }}>
                    <View style={{ backgroundColor:C.accent, borderRadius:10, paddingHorizontal:14, paddingVertical:8 }}>
                      <Text style={{ fontSize:13, fontWeight:'700', color:'#fff' }}>Start</Text>
                    </View>
                  </TouchableOpacity>
                </TouchableOpacity>
              </SwipeableRow>
            </View>
          );
        })}

        {/* ── RECENT WORKOUTS ── */}
        {history.length > 0 && (
          <TouchableOpacity style={wkStyles.sectionRow} onPress={() => setRecentCollapsed(v => !v)} activeOpacity={0.7}>
            <Text style={[wkStyles.sectionTitle, { marginTop:20 }]}>Recent</Text>
            <Ionicons name={recentCollapsed ? 'chevron-forward' : 'chevron-down'} size={15} color={C.t3} style={{ marginTop:20 }} />
          </TouchableOpacity>
        )}
        {history.length === 0 && (
          <View style={wkStyles.emptyBox}>
            <Text style={wkStyles.emptyText}>No workouts logged yet. Start one above!</Text>
          </View>
        )}
        {!recentCollapsed && history.slice(0,5).map(w => {
          const isCardio     = w.type === 'cardio';
          const hasPR        = !isCardio && prMap.has(w.id);
          const primaryMuscle = w.exercises?.[0]?.muscle;
          const barColor     = isCardio ? '#30D158' : (MUSCLE_META[primaryMuscle]?.color || C.accent);
          const muscles      = [...new Set((w.exercises || []).map(e => e.muscle).filter(Boolean))];
          return (
            <View key={w.id} style={{ marginHorizontal:16, marginBottom:10, borderRadius:14, overflow:'hidden', backgroundColor:C.surface, flexDirection:'row' }}>
              <View style={{ width:4, backgroundColor: barColor }} />
              <View style={{ flex:1, padding:14 }}>
                <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start', marginBottom:5 }}>
                  <View style={{ flex:1, marginRight:8 }}>
                    <View style={{ flexDirection:'row', alignItems:'center', gap:7, marginBottom:2, flexWrap:'wrap' }}>
                      {isCardio && (
                        <View style={{ backgroundColor:'#30D15822', borderRadius:6, paddingHorizontal:6, paddingVertical:2 }}>
                          <Text style={{ fontSize:10, fontWeight:'800', color:'#30D158' }}>CARDIO</Text>
                        </View>
                      )}
                      <Text style={{ fontSize:16, fontWeight:'700', color:C.t1 }}>{w.name}</Text>
                      {hasPR && (
                        <View style={{ backgroundColor:'rgba(255,215,0,0.15)', borderRadius:6, paddingHorizontal:6, paddingVertical:2 }}>
                          <Text style={{ fontSize:10, fontWeight:'800', color:'#FFD60A' }}>PR</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ fontSize:12, color:C.t3 }}>{fmtWkDate(w.date)}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setShareTarget(w)} hitSlop={8}
                    style={{ width:30, height:30, borderRadius:15, backgroundColor:C.s2, alignItems:'center', justifyContent:'center' }}>
                    <Ionicons name="share-social" size={13} color={C.t2} />
                  </TouchableOpacity>
                </View>
                {isCardio ? (
                  <Text style={{ fontSize:12, color:C.t2, fontWeight:'500' }}>
                    {fmtDuration(w.duration)}
                    {w.distance > 0 ? ` · ${w.distance} ${weightUnit === 'lbs' ? 'mi' : 'km'}` : ''}
                    {w.speed > 0    ? ` · ${w.speed} ${weightUnit === 'lbs' ? 'mph' : 'km/h'}` : ''}
                    {w.incline > 0  ? ` · ${w.incline}% incline` : ''}
                    {w.calories > 0 ? ` · ${w.calories} kcal` : ''}
                  </Text>
                ) : (
                  <>
                    {muscles.length > 0 && (
                      <View style={{ flexDirection:'row', gap:4, flexWrap:'wrap', marginBottom:8 }}>
                        {muscles.slice(0,4).map(m => (
                          <View key={m} style={{ backgroundColor:(MUSCLE_META[m]?.color || C.accent)+'22', borderRadius:6, paddingHorizontal:6, paddingVertical:2 }}>
                            <Text style={{ fontSize:10, fontWeight:'700', color: MUSCLE_META[m]?.color || C.accent }}>{m}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    <Text style={{ fontSize:12, color:C.t2, fontWeight:'500' }}>
                      {fmtDuration(w.duration)} · {(w.volume||0).toLocaleString()} {weightUnit}
                      {w.exercises?.length ? ` · ${w.exercises.length} exercises` : ''}
                    </Text>
                  </>
                )}
              </View>
            </View>
          );
        })}

      </ScrollView>
      )}

      {/* Active workout overlay (covers screen, tab bar stays accessible) */}
      {activeWorkout && !minimized && (
        <ActiveWorkoutModal
          workout={activeWorkout}
          setWorkout={setActiveWorkout}
          onFinish={finishWorkout}
          onSaveRoutine={saveRoutine}
          getPrevious={getPrevious}
          onMinimize={() => setMinimized(true)}
          elapsed={elapsed}
          unit={weightUnit}
        />
      )}

      {/* Mini bar when minimized */}
      {activeWorkout && minimized && (
        <TouchableOpacity
          onPress={() => setMinimized(false)}
          activeOpacity={0.88}
          style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 50,
            backgroundColor: C.surface,
            borderTopWidth: 2, borderTopColor: C.accent,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 20, paddingVertical: 11,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#30D158' }} />
            <Text style={{ color: C.t1, fontWeight: '700', fontSize: 14, letterSpacing: -0.2 }}>
              {activeWorkout.name}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={{ color: C.accent, fontSize: 14, fontWeight: '700', letterSpacing: -0.3 }}>
              {fmtTimer(elapsed)}
            </Text>
            <Ionicons name="chevron-up" size={18} color={C.t2} />
          </View>
        </TouchableOpacity>
      )}

      {/* Exercise library */}
      <ExerciseLibraryModal
        visible={showLibrary}
        onClose={() => setShowLibrary(false)}
        onAddToWorkout={activeWorkout ? addToActiveWorkout : null}
      />

      {/* Routine builder */}
      {buildingRoutine !== null && (
        <RoutineBuilderModal routine={buildingRoutine} onSave={saveRoutine} onClose={() => setBuildingRoutine(null)} />
      )}

      <WorkoutShareModal
        visible={!!shareTarget}
        onClose={() => setShareTarget(null)}
        workout={shareTarget}
      />
      <PlateCalculatorModal visible={showPlateCalc} onClose={() => setShowPlateCalc(false)} />
      <CardioLogModal
        visible={showCardioLog}
        onClose={() => setShowCardioLog(false)}
        weightUnit={weightUnit}
        onSave={() => { setShowCardioLog(false); reload(); showWkToast('Cardio session saved!'); }}
      />

      {/* Undo toast for routine delete */}
      <Animated.View
        pointerEvents="box-none"
        style={{ position:'absolute', bottom: insets.bottom + 16, alignSelf:'center', zIndex:99,
          flexDirection:'row', alignItems:'center', gap:10,
          backgroundColor:'rgba(44,44,46,0.97)', borderRadius:14,
          paddingVertical:11, paddingHorizontal:18,
          shadowColor:'#000', shadowOpacity:0.35, shadowRadius:12, shadowOffset:{width:0,height:4},
          opacity: wkToastOpacity, transform: [{ translateY: wkToastY }] }}>
        <Text style={{ color:'#fff', fontSize:14, fontWeight:'500' }}>{wkToastMsg}</Text>
        {undoRoutine && (
          <TouchableOpacity
            hitSlop={8}
            onPress={() => {
              clearTimeout(wkToastTimer.current);
              const { routine, idx } = undoRoutine;
              setRoutines(prev => {
                const next = [...prev];
                next.splice(idx, 0, routine);
                AsyncStorage.setItem(ROUTINES_KEY, JSON.stringify(next));
                return next;
              });
              setUndoRoutine(null);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              Animated.parallel([
                Animated.timing(wkToastOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
                Animated.timing(wkToastY, { toValue: 8, duration: 200, useNativeDriver: true }),
              ]).start();
            }}>
            <Text style={{ color:'#0A84FF', fontSize:14, fontWeight:'700' }}>Undo</Text>
          </TouchableOpacity>
        )}
      </Animated.View>
    </View>
  );
}

function SkeletonShimmer() {
  const shimmer = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.85] });
  return <Animated.View style={{ position:'absolute', inset:0, backgroundColor:'rgba(255,255,255,0.08)', opacity }} />;
}

function AISpinner() {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, useNativeDriver: true, easing: Easing.linear })).start();
  }, []);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <Animated.View style={{ transform: [{ rotate }] }}>
        <Ionicons name="refresh" size={28} color="#0A84FF" />
      </Animated.View>
      <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, fontWeight: '500' }}>Analysing…</Text>
    </View>
  );
}

const FOOD_DB = [
  { id: 1,  name: 'Chicken Breast',   brand: 'Generic',        cal: 165, p: 31, c: 0,  f: 4,  serving: '100g',     fiber: 0, sugar: 0,  satFat: 1,  sodium: 74  },
  { id: 2,  name: 'Brown Rice',       brand: 'Generic',        cal: 216, p: 5,  c: 45, f: 2,  serving: '1 cup',    fiber: 4, sugar: 0,  satFat: 0,  sodium: 10  },
  { id: 3,  name: 'Oats',             brand: 'Quaker',         cal: 150, p: 5,  c: 27, f: 3,  serving: '½ cup',    fiber: 4, sugar: 1,  satFat: 1,  sodium: 0   },
  { id: 4,  name: 'Banana',           brand: 'Generic',        cal: 89,  p: 1,  c: 23, f: 0,  serving: '1 medium', fiber: 3, sugar: 12, satFat: 0,  sodium: 1   },
  { id: 5,  name: 'Eggs',             brand: 'Generic',        cal: 78,  p: 6,  c: 0,  f: 5,  serving: '1 large',  fiber: 0, sugar: 0,  satFat: 2,  sodium: 62  },
  { id: 6,  name: 'Greek Yogurt',     brand: 'Fage',           cal: 100, p: 17, c: 6,  f: 0,  serving: '170g',     fiber: 0, sugar: 4,  satFat: 0,  sodium: 65  },
  { id: 7,  name: 'Almonds',          brand: 'Blue Diamond',   cal: 170, p: 6,  c: 6,  f: 15, serving: '28g',      fiber: 3, sugar: 1,  satFat: 1,  sodium: 0   },
  { id: 8,  name: 'Salmon',           brand: 'Generic',        cal: 208, p: 28, c: 0,  f: 10, serving: '100g',     fiber: 0, sugar: 0,  satFat: 2,  sodium: 59  },
  { id: 9,  name: 'Sweet Potato',     brand: 'Generic',        cal: 130, p: 2,  c: 30, f: 0,  serving: '1 medium', fiber: 4, sugar: 6,  satFat: 0,  sodium: 41  },
  { id: 10, name: 'Whey Protein',     brand: 'MyProtein',      cal: 130, p: 25, c: 4,  f: 2,  serving: '1 scoop',  fiber: 0, sugar: 2,  satFat: 1,  sodium: 80  },
  { id: 11, name: 'Broccoli',         brand: 'Generic',        cal: 55,  p: 4,  c: 11, f: 1,  serving: '1 cup',    fiber: 5, sugar: 3,  satFat: 0,  sodium: 64  },
  { id: 12, name: 'Apple',            brand: 'Generic',        cal: 95,  p: 0,  c: 25, f: 0,  serving: '1 medium', fiber: 4, sugar: 19, satFat: 0,  sodium: 2   },
  { id: 13, name: 'Cottage Cheese',   brand: 'Breakstone',     cal: 110, p: 14, c: 3,  f: 5,  serving: '½ cup',    fiber: 0, sugar: 3,  satFat: 3,  sodium: 380 },
  { id: 14, name: 'Peanut Butter',    brand: 'Skippy',         cal: 190, p: 8,  c: 6,  f: 16, serving: '2 tbsp',   fiber: 2, sugar: 3,  satFat: 3,  sodium: 140 },
  { id: 15, name: 'White Rice',       brand: 'Generic',        cal: 200, p: 4,  c: 44, f: 0,  serving: '1 cup',    fiber: 1, sugar: 0,  satFat: 0,  sodium: 2   },
  { id: 16, name: 'Avocado',          brand: 'Generic',        cal: 160, p: 2,  c: 9,  f: 15, serving: '½ medium', fiber: 5, sugar: 1,  satFat: 2,  sodium: 7   },
  { id: 17, name: 'Tuna (canned)',    brand: 'Chicken of Sea', cal: 109, p: 25, c: 0,  f: 1,  serving: '100g',     fiber: 0, sugar: 0,  satFat: 0,  sodium: 320 },
  { id: 18, name: 'Milk (whole)',     brand: 'Generic',        cal: 149, p: 8,  c: 12, f: 8,  serving: '1 cup',    fiber: 0, sugar: 12, satFat: 5,  sodium: 105 },
  { id: 19, name: 'Pasta',            brand: 'Barilla',        cal: 220, p: 8,  c: 43, f: 1,  serving: '1 cup',    fiber: 3, sugar: 1,  satFat: 0,  sodium: 3   },
  { id: 20, name: 'Olive Oil',        brand: 'Kirkland',       cal: 119, p: 0,  c: 0,  f: 14, serving: '1 tbsp',   fiber: 0, sugar: 0,  satFat: 2,  sodium: 0   },
];

const RECENTS_KEY = 'recentFoods';
const USDA_KEY   = process.env.EXPO_PUBLIC_USDA_KEY || 'DEMO_KEY';

// ── RESTAURANTS DATABASE ──────────────────────────────────
const UNVERIFIED_RESTAURANTS_DB = [
  {
    id: 'mcdonalds', name: "McDonald's", category: 'Fast Food',
    items: [
      { id: 'mc1',  name: 'Big Mac',                  serving: '1 burger',   cal: 550, p: 25, c: 45, f: 30, fiber: 3, sugar: 9,  satFat: 10, sodium: 1010 },
      { id: 'mc2',  name: 'McChicken',                serving: '1 burger',   cal: 400, p: 20, c: 42, f: 17, fiber: 2, sugar: 5,  satFat: 3,  sodium: 690  },
      { id: 'mc3',  name: 'Chicken McNuggets 6pc',    serving: '6 pieces',   cal: 280, p: 16, c: 18, f: 16, fiber: 1, sugar: 0,  satFat: 3,  sodium: 510  },
      { id: 'mc4',  name: 'Chicken McNuggets 9pc',    serving: '9 pieces',   cal: 420, p: 24, c: 27, f: 24, fiber: 2, sugar: 0,  satFat: 5,  sodium: 760  },
      { id: 'mc5',  name: 'Large Fries',              serving: '1 large',    cal: 490, p: 6,  c: 66, f: 23, fiber: 6, sugar: 0,  satFat: 3,  sodium: 400  },
      { id: 'mc6',  name: 'Medium Fries',             serving: '1 medium',   cal: 320, p: 4,  c: 44, f: 15, fiber: 4, sugar: 0,  satFat: 2,  sodium: 270  },
      { id: 'mc7',  name: 'Quarter Pounder w/ Cheese',serving: '1 burger',   cal: 520, p: 30, c: 43, f: 26, fiber: 2, sugar: 10, satFat: 12, sodium: 1120 },
      { id: 'mc8',  name: 'Filet-O-Fish',             serving: '1 burger',   cal: 390, p: 16, c: 39, f: 19, fiber: 1, sugar: 5,  satFat: 4,  sodium: 580  },
      { id: 'mc9',  name: 'McDouble',                 serving: '1 burger',   cal: 450, p: 25, c: 34, f: 23, fiber: 2, sugar: 7,  satFat: 10, sodium: 870  },
      { id: 'mc10', name: 'McFlurry Oreo',            serving: '1 medium',   cal: 510, p: 12, c: 80, f: 17, fiber: 1, sugar: 64, satFat: 10, sodium: 340  },
      { id: 'mc11', name: 'Apple Pie',                serving: '1 piece',    cal: 240, p: 3,  c: 35, f: 11, fiber: 2, sugar: 13, satFat: 5,  sodium: 95   },
      { id: 'mc12', name: 'Egg McMuffin',             serving: '1 muffin',   cal: 300, p: 17, c: 30, f: 12, fiber: 2, sugar: 3,  satFat: 6,  sodium: 760  },
    ],
  },
  {
    id: 'kfc', name: 'KFC', category: 'Fast Food',
    items: [
      { id: 'kfc1',  name: 'Original Recipe Chicken (1pc)', serving: '1 piece',  cal: 320, p: 28, c: 12, f: 18, fiber: 0, sugar: 0, satFat: 4,  sodium: 710  },
      { id: 'kfc2',  name: 'Zinger Burger',                 serving: '1 burger', cal: 490, p: 28, c: 46, f: 21, fiber: 2, sugar: 6, satFat: 4,  sodium: 900  },
      { id: 'kfc3',  name: 'Crispy Strips 3pc',             serving: '3 strips', cal: 370, p: 30, c: 30, f: 14, fiber: 1, sugar: 0, satFat: 3,  sodium: 830  },
      { id: 'kfc4',  name: 'Hot Wings 5pc',                 serving: '5 wings',  cal: 370, p: 24, c: 22, f: 21, fiber: 1, sugar: 1, satFat: 5,  sodium: 830  },
      { id: 'kfc5',  name: 'Bucket 2pc (Original)',         serving: '2 pieces', cal: 640, p: 56, c: 24, f: 36, fiber: 0, sugar: 0, satFat: 8,  sodium: 1420 },
      { id: 'kfc6',  name: 'Large Fries',                   serving: '1 large',  cal: 460, p: 6,  c: 63, f: 20, fiber: 5, sugar: 0, satFat: 4,  sodium: 760  },
      { id: 'kfc7',  name: 'Mashed Potato & Gravy',         serving: '1 cup',    cal: 130, p: 3,  c: 21, f: 4,  fiber: 1, sugar: 1, satFat: 1,  sodium: 580  },
      { id: 'kfc8',  name: 'Coleslaw',                      serving: '1 regular',cal: 140, p: 1,  c: 20, f: 6,  fiber: 2, sugar: 14,satFat: 1,  sodium: 200  },
      { id: 'kfc9',  name: 'Corn on the Cob',               serving: '1 cob',    cal: 70,  p: 2,  c: 13, f: 2,  fiber: 2, sugar: 5, satFat: 0,  sodium: 5    },
    ],
  },
  {
    id: 'subway', name: 'Subway', category: 'Fast Food',
    items: [
      { id: 'sub1', name: 'Italian BMT (6")',        serving: '6" sub',   cal: 410, p: 21, c: 44, f: 17, fiber: 3, sugar: 7,  satFat: 6,  sodium: 1290 },
      { id: 'sub2', name: 'Chicken Teriyaki (6")',   serving: '6" sub',   cal: 370, p: 24, c: 51, f: 6,  fiber: 3, sugar: 15, satFat: 2,  sodium: 830  },
      { id: 'sub3', name: 'Turkey Breast (6")',      serving: '6" sub',   cal: 280, p: 18, c: 44, f: 4,  fiber: 3, sugar: 6,  satFat: 1,  sodium: 800  },
      { id: 'sub4', name: 'Tuna (6")',               serving: '6" sub',   cal: 530, p: 22, c: 44, f: 27, fiber: 3, sugar: 6,  satFat: 5,  sodium: 760  },
      { id: 'sub5', name: 'Steak & Cheese (6")',     serving: '6" sub',   cal: 380, p: 26, c: 44, f: 10, fiber: 3, sugar: 6,  satFat: 4,  sodium: 880  },
      { id: 'sub6', name: 'Veggie Delite (6")',      serving: '6" sub',   cal: 230, p: 9,  c: 44, f: 3,  fiber: 4, sugar: 6,  satFat: 1,  sodium: 400  },
      { id: 'sub7', name: 'Meatball Marinara (6")',  serving: '6" sub',   cal: 480, p: 23, c: 55, f: 18, fiber: 4, sugar: 10, satFat: 7,  sodium: 1060 },
      { id: 'sub8', name: 'Chocolate Chip Cookie',   serving: '1 cookie', cal: 220, p: 2,  c: 30, f: 10, fiber: 1, sugar: 18, satFat: 5,  sodium: 160  },
    ],
  },
  {
    id: 'pizzahut', name: 'Pizza Hut', category: 'Fast Food',
    items: [
      { id: 'ph1', name: 'Pepperoni (1 slice, large)', serving: '1 slice', cal: 280, p: 12, c: 29, f: 13, fiber: 1, sugar: 3, satFat: 5, sodium: 640  },
      { id: 'ph2', name: 'Cheese (1 slice, large)',    serving: '1 slice', cal: 250, p: 11, c: 29, f: 11, fiber: 1, sugar: 3, satFat: 5, sodium: 520  },
      { id: 'ph3', name: 'BBQ Chicken (1 slice)',      serving: '1 slice', cal: 240, p: 13, c: 32, f: 7,  fiber: 1, sugar: 5, satFat: 3, sodium: 560  },
      { id: 'ph4', name: 'Super Supreme (1 slice)',    serving: '1 slice', cal: 290, p: 13, c: 29, f: 14, fiber: 2, sugar: 4, satFat: 6, sodium: 680  },
      { id: 'ph5', name: 'Veggie Lovers (1 slice)',    serving: '1 slice', cal: 220, p: 9,  c: 30, f: 8,  fiber: 2, sugar: 4, satFat: 3, sodium: 480  },
      { id: 'ph6', name: 'Breadsticks (2pc)',          serving: '2 sticks',cal: 170, p: 5,  c: 28, f: 5,  fiber: 1, sugar: 1, satFat: 1, sodium: 340  },
      { id: 'ph7', name: 'Garlic Bread (2pc)',         serving: '2 slices',cal: 200, p: 5,  c: 30, f: 7,  fiber: 1, sugar: 1, satFat: 2, sodium: 360  },
    ],
  },
  {
    id: 'burgerking', name: 'Burger King', category: 'Fast Food',
    items: [
      { id: 'bk1', name: 'Whopper',               serving: '1 burger', cal: 660, p: 28, c: 49, f: 40, fiber: 2, sugar: 11, satFat: 12, sodium: 980  },
      { id: 'bk2', name: 'Double Whopper',         serving: '1 burger', cal: 900, p: 48, c: 49, f: 58, fiber: 2, sugar: 11, satFat: 22, sodium: 1060 },
      { id: 'bk3', name: 'Crispy Chicken Sandwich',serving: '1 burger', cal: 540, p: 26, c: 49, f: 27, fiber: 1, sugar: 7,  satFat: 5,  sodium: 1010 },
      { id: 'bk4', name: 'Chicken Fries 9pc',      serving: '9 pieces', cal: 290, p: 19, c: 21, f: 15, fiber: 0, sugar: 0,  satFat: 3,  sodium: 800  },
      { id: 'bk5', name: 'Medium Fries',           serving: '1 medium', cal: 380, p: 4,  c: 54, f: 16, fiber: 4, sugar: 0,  satFat: 3,  sodium: 490  },
      { id: 'bk6', name: 'Onion Rings (medium)',   serving: '1 medium', cal: 410, p: 5,  c: 55, f: 19, fiber: 3, sugar: 5,  satFat: 4,  sodium: 590  },
      { id: 'bk7', name: 'Soft Serve Cone',        serving: '1 cone',   cal: 180, p: 4,  c: 28, f: 5,  fiber: 0, sugar: 18, satFat: 3,  sodium: 90   },
    ],
  },
  {
    id: 'nandos', name: "Nando's", category: 'Fast Food',
    items: [
      { id: 'nan1', name: '1/4 Chicken (Peri-Peri)',  serving: '1 quarter',  cal: 290, p: 38, c: 1,  f: 13, fiber: 0, sugar: 0, satFat: 3, sodium: 480  },
      { id: 'nan2', name: '1/2 Chicken (Peri-Peri)',  serving: '1 half',     cal: 580, p: 76, c: 2,  f: 26, fiber: 0, sugar: 0, satFat: 6, sodium: 960  },
      { id: 'nan3', name: 'Chicken Wrap',             serving: '1 wrap',     cal: 480, p: 36, c: 42, f: 18, fiber: 3, sugar: 4, satFat: 4, sodium: 870  },
      { id: 'nan4', name: 'Butterfly Chicken Burger', serving: '1 burger',   cal: 510, p: 42, c: 40, f: 19, fiber: 2, sugar: 5, satFat: 4, sodium: 810  },
      { id: 'nan5', name: 'Peri-Peri Fries',          serving: '1 regular',  cal: 380, p: 5,  c: 52, f: 16, fiber: 4, sugar: 1, satFat: 3, sodium: 560  },
      { id: 'nan6', name: 'Corn on the Cob',          serving: '1 cob',      cal: 135, p: 4,  c: 24, f: 5,  fiber: 3, sugar: 5, satFat: 1, sodium: 55   },
      { id: 'nan7', name: 'Garlic Bread',             serving: '2 slices',   cal: 260, p: 7,  c: 38, f: 9,  fiber: 2, sugar: 1, satFat: 2, sodium: 450  },
      { id: 'nan8', name: 'Coleslaw',                 serving: '1 regular',  cal: 130, p: 1,  c: 16, f: 7,  fiber: 2, sugar: 12,satFat: 1, sodium: 180  },
    ],
  },
  {
    id: 'albaik', name: 'Al Baik', category: 'Saudi Local',
    items: [
      { id: 'ab1', name: 'Broast 2 Pieces',          serving: '2 pieces',   cal: 480, p: 38, c: 22, f: 26, fiber: 1, sugar: 0, satFat: 6,  sodium: 880  },
      { id: 'ab2', name: 'Broast 4 Pieces',          serving: '4 pieces',   cal: 960, p: 76, c: 44, f: 52, fiber: 2, sugar: 0, satFat: 12, sodium: 1760 },
      { id: 'ab3', name: 'Shrimp Meal 9pc',          serving: '9 pieces',   cal: 350, p: 22, c: 28, f: 16, fiber: 1, sugar: 1, satFat: 3,  sodium: 820  },
      { id: 'ab4', name: 'Chicken Sandwich',         serving: '1 sandwich', cal: 520, p: 32, c: 45, f: 23, fiber: 2, sugar: 5, satFat: 5,  sodium: 940  },
      { id: 'ab5', name: 'Hush Puppies 6pc',         serving: '6 pieces',   cal: 280, p: 5,  c: 36, f: 13, fiber: 2, sugar: 4, satFat: 3,  sodium: 480  },
      { id: 'ab6', name: 'French Fries',             serving: '1 regular',  cal: 340, p: 4,  c: 48, f: 14, fiber: 4, sugar: 0, satFat: 3,  sodium: 360  },
      { id: 'ab7', name: 'Coleslaw',                 serving: '1 cup',      cal: 120, p: 1,  c: 14, f: 7,  fiber: 2, sugar: 10,satFat: 1,  sodium: 200  },
      { id: 'ab8', name: 'Kids Broast 1pc + Fries',  serving: '1 meal',     cal: 580, p: 28, c: 58, f: 28, fiber: 4, sugar: 0, satFat: 6,  sodium: 960  },
    ],
  },
  {
    id: 'kudu', name: 'Kudu', category: 'Saudi Local',
    items: [
      { id: 'ku1', name: 'Classic Burger',            serving: '1 burger',  cal: 560, p: 28, c: 44, f: 31, fiber: 2, sugar: 8,  satFat: 12, sodium: 980  },
      { id: 'ku2', name: 'Chicken Burger',            serving: '1 burger',  cal: 490, p: 26, c: 46, f: 22, fiber: 2, sugar: 6,  satFat: 5,  sodium: 860  },
      { id: 'ku3', name: 'Grilled Chicken Sandwich',  serving: '1 sandwich',cal: 420, p: 34, c: 38, f: 14, fiber: 2, sugar: 5,  satFat: 3,  sodium: 780  },
      { id: 'ku4', name: 'Double Burger',             serving: '1 burger',  cal: 720, p: 44, c: 44, f: 42, fiber: 2, sugar: 8,  satFat: 18, sodium: 1200 },
      { id: 'ku5', name: 'Crispy Fries',              serving: '1 regular', cal: 360, p: 5,  c: 50, f: 16, fiber: 4, sugar: 0,  satFat: 3,  sodium: 420  },
      { id: 'ku6', name: 'Onion Rings',               serving: '1 regular', cal: 310, p: 4,  c: 40, f: 15, fiber: 2, sugar: 4,  satFat: 3,  sodium: 380  },
    ],
  },
  {
    id: 'herfy', name: 'Herfy', category: 'Saudi Local',
    items: [
      { id: 'hf1', name: 'Herfy Burger',        serving: '1 burger',  cal: 520, p: 27, c: 42, f: 28, fiber: 2, sugar: 7,  satFat: 10, sodium: 920  },
      { id: 'hf2', name: 'Double Herfy Burger', serving: '1 burger',  cal: 760, p: 46, c: 44, f: 46, fiber: 2, sugar: 7,  satFat: 18, sodium: 1240 },
      { id: 'hf3', name: 'Chicken Burger',      serving: '1 burger',  cal: 460, p: 24, c: 44, f: 20, fiber: 2, sugar: 6,  satFat: 4,  sodium: 820  },
      { id: 'hf4', name: 'Fish Burger',         serving: '1 burger',  cal: 420, p: 20, c: 46, f: 17, fiber: 2, sugar: 5,  satFat: 3,  sodium: 760  },
      { id: 'hf5', name: 'French Fries',        serving: '1 regular', cal: 340, p: 4,  c: 48, f: 14, fiber: 4, sugar: 0,  satFat: 3,  sodium: 360  },
      { id: 'hf6', name: 'Onion Rings',         serving: '1 regular', cal: 290, p: 4,  c: 38, f: 14, fiber: 2, sugar: 3,  satFat: 3,  sodium: 340  },
    ],
  },
  {
    id: 'shawarmer', name: 'Shawarmer', category: 'Saudi Local',
    items: [
      { id: 'shw1', name: 'Chicken Shawarma Sandwich',       serving: '1 sandwich', cal: 420, p: 28, c: 42, f: 16, fiber: 3, sugar: 4, satFat: 4, sodium: 780 },
      { id: 'shw2', name: 'Beef Shawarma Sandwich',          serving: '1 sandwich', cal: 520, p: 30, c: 40, f: 26, fiber: 3, sugar: 4, satFat: 9, sodium: 850 },
      { id: 'shw3', name: 'Chicken Shawarma Plate',          serving: '1 plate',    cal: 720, p: 48, c: 58, f: 32, fiber: 5, sugar: 5, satFat: 8, sodium: 1280 },
      { id: 'shw4', name: 'Arabic Chicken Shawarma',         serving: '1 meal',     cal: 620, p: 42, c: 54, f: 25, fiber: 4, sugar: 4, satFat: 6, sodium: 1080 },
      { id: 'shw5', name: 'Garlic Fries',                    serving: '1 regular',  cal: 420, p: 5,  c: 52, f: 20, fiber: 4, sugar: 1, satFat: 4, sodium: 560 },
      { id: 'shw6', name: 'Chicken Shawarma Rice Bowl',      serving: '1 bowl',     cal: 680, p: 44, c: 72, f: 20, fiber: 4, sugar: 4, satFat: 5, sodium: 980 },
    ],
  },
  {
    id: 'altazaj', name: 'Al Tazaj', category: 'Saudi Local',
    items: [
      { id: 'tz1', name: 'Grilled Chicken Half',       serving: '1 half chicken', cal: 560, p: 72, c: 3,  f: 28, fiber: 0, sugar: 0, satFat: 7, sodium: 980 },
      { id: 'tz2', name: 'Grilled Chicken Quarter',    serving: '1 quarter',      cal: 280, p: 36, c: 2,  f: 14, fiber: 0, sugar: 0, satFat: 4, sodium: 490 },
      { id: 'tz3', name: 'Chicken Kabsa Meal',         serving: '1 meal',         cal: 780, p: 48, c: 88, f: 24, fiber: 4, sugar: 3, satFat: 7, sodium: 1120 },
      { id: 'tz4', name: 'Chicken Burger',             serving: '1 burger',       cal: 460, p: 28, c: 44, f: 18, fiber: 2, sugar: 6, satFat: 4, sodium: 760 },
      { id: 'tz5', name: 'Basmati Rice',               serving: '1 cup',          cal: 260, p: 5,  c: 56, f: 2,  fiber: 1, sugar: 0, satFat: 0, sodium: 320 },
      { id: 'tz6', name: 'Garlic Sauce',               serving: '2 tbsp',         cal: 160, p: 1,  c: 2,  f: 17, fiber: 0, sugar: 1, satFat: 2, sodium: 180 },
    ],
  },
  {
    id: 'maestropizza', name: 'Maestro Pizza', category: 'Saudi Local',
    items: [
      { id: 'mp1', name: 'Margherita Pizza Slice',     serving: '1 slice', cal: 230, p: 10, c: 28, f: 9,  fiber: 1, sugar: 3, satFat: 4, sodium: 520 },
      { id: 'mp2', name: 'Pepperoni Pizza Slice',      serving: '1 slice', cal: 280, p: 12, c: 29, f: 13, fiber: 1, sugar: 3, satFat: 5, sodium: 660 },
      { id: 'mp3', name: 'Chicken Ranch Pizza Slice',  serving: '1 slice', cal: 300, p: 14, c: 30, f: 14, fiber: 1, sugar: 3, satFat: 5, sodium: 690 },
      { id: 'mp4', name: 'Veggie Pizza Slice',         serving: '1 slice', cal: 240, p: 10, c: 31, f: 9,  fiber: 2, sugar: 4, satFat: 4, sodium: 540 },
      { id: 'mp5', name: 'Cheesy Bread',               serving: '2 pieces',cal: 260, p: 9,  c: 28, f: 12, fiber: 1, sugar: 2, satFat: 6, sodium: 520 },
      { id: 'mp6', name: 'Potato Wedges',              serving: '1 regular',cal: 340, p: 5, c: 48, f: 14, fiber: 4, sugar: 1, satFat: 3, sodium: 560 },
    ],
  },
  {
    id: 'starbucks', name: 'Starbucks', category: 'Coffee & Desserts',
    items: [
      { id: 'sb1',  name: 'Caramel Frappuccino (Grande)',  serving: '16 fl oz',  cal: 420, p: 5,  c: 66, f: 16, fiber: 0, sugar: 62, satFat: 10, sodium: 230 },
      { id: 'sb2',  name: 'Latte (Grande, 2% milk)',        serving: '16 fl oz',  cal: 190, p: 13, c: 19, f: 7,  fiber: 0, sugar: 18, satFat: 5,  sodium: 170 },
      { id: 'sb3',  name: 'Flat White (Grande)',            serving: '16 fl oz',  cal: 220, p: 14, c: 22, f: 9,  fiber: 0, sugar: 20, satFat: 5,  sodium: 160 },
      { id: 'sb4',  name: 'Iced Americano (Grande)',        serving: '16 fl oz',  cal: 15,  p: 1,  c: 3,  f: 0,  fiber: 0, sugar: 0,  satFat: 0,  sodium: 15  },
      { id: 'sb5',  name: 'Mocha Frappuccino (Grande)',     serving: '16 fl oz',  cal: 400, p: 6,  c: 63, f: 15, fiber: 1, sugar: 56, satFat: 9,  sodium: 240 },
      { id: 'sb6',  name: 'Vanilla Latte (Grande)',         serving: '16 fl oz',  cal: 250, p: 13, c: 35, f: 6,  fiber: 0, sugar: 35, satFat: 4,  sodium: 170 },
      { id: 'sb7',  name: 'Blueberry Muffin',               serving: '1 muffin',  cal: 380, p: 6,  c: 55, f: 16, fiber: 2, sugar: 33, satFat: 3,  sodium: 350 },
      { id: 'sb8',  name: 'Chocolate Croissant',            serving: '1 piece',   cal: 310, p: 6,  c: 34, f: 17, fiber: 2, sugar: 10, satFat: 9,  sodium: 200 },
      { id: 'sb9',  name: 'Egg & Cheese Protein Box',       serving: '1 box',     cal: 470, p: 24, c: 56, f: 18, fiber: 3, sugar: 9,  satFat: 7,  sodium: 880 },
      { id: 'sb10', name: 'Butter Croissant',               serving: '1 piece',   cal: 260, p: 5,  c: 31, f: 14, fiber: 1, sugar: 5,  satFat: 8,  sodium: 230 },
    ],
  },
  {
    id: 'timhortons', name: 'Tim Hortons', category: 'Coffee & Desserts',
    items: [
      { id: 'th1', name: 'Double Double Coffee',  serving: '1 medium',  cal: 230, p: 3,  c: 30, f: 11, fiber: 0, sugar: 27, satFat: 7,  sodium: 105 },
      { id: 'th2', name: 'Steeped Tea (milk)',     serving: '1 medium',  cal: 45,  p: 1,  c: 10, f: 0,  fiber: 0, sugar: 10, satFat: 0,  sodium: 30  },
      { id: 'th3', name: 'Original Blend Coffee', serving: '1 medium',  cal: 5,   p: 0,  c: 1,  f: 0,  fiber: 0, sugar: 0,  satFat: 0,  sodium: 5   },
      { id: 'th4', name: 'Glazed Donut',           serving: '1 donut',   cal: 260, p: 4,  c: 38, f: 11, fiber: 1, sugar: 16, satFat: 5,  sodium: 250 },
      { id: 'th5', name: 'Boston Cream Donut',     serving: '1 donut',   cal: 290, p: 4,  c: 44, f: 11, fiber: 1, sugar: 22, satFat: 5,  sodium: 270 },
      { id: 'th6', name: 'Chocolate Chip Muffin',  serving: '1 muffin',  cal: 400, p: 6,  c: 59, f: 17, fiber: 2, sugar: 34, satFat: 5,  sodium: 390 },
      { id: 'th7', name: 'Everything Bagel',        serving: '1 bagel',   cal: 290, p: 10, c: 58, f: 2,  fiber: 3, sugar: 5,  satFat: 0,  sodium: 510 },
      { id: 'th8', name: 'Chicken Sandwich',        serving: '1 sandwich',cal: 470, p: 27, c: 48, f: 18, fiber: 2, sugar: 6,  satFat: 4,  sodium: 940 },
    ],
  },
  {
    id: 'dunkin', name: "Dunkin'", category: 'Coffee & Desserts',
    items: [
      { id: 'dk1', name: 'Glazed Donut',             serving: '1 donut',  cal: 270, p: 3,  c: 33, f: 14, fiber: 1, sugar: 14, satFat: 6,  sodium: 310 },
      { id: 'dk2', name: 'Boston Cream Donut',        serving: '1 donut',  cal: 300, p: 5,  c: 44, f: 13, fiber: 1, sugar: 22, satFat: 5,  sodium: 330 },
      { id: 'dk3', name: 'Chocolate Frosted Donut',   serving: '1 donut',  cal: 290, p: 3,  c: 37, f: 14, fiber: 1, sugar: 18, satFat: 6,  sodium: 340 },
      { id: 'dk4', name: 'Iced Coffee (Medium)',       serving: '1 medium', cal: 260, p: 4,  c: 42, f: 9,  fiber: 0, sugar: 38, satFat: 6,  sodium: 230 },
      { id: 'dk5', name: 'Egg & Cheese Croissant',    serving: '1 piece',  cal: 360, p: 14, c: 36, f: 18, fiber: 1, sugar: 5,  satFat: 9,  sodium: 750 },
      { id: 'dk6', name: 'Hash Browns',               serving: '3 pieces', cal: 200, p: 2,  c: 24, f: 10, fiber: 2, sugar: 0,  satFat: 2,  sodium: 460 },
      { id: 'dk7', name: 'Bagel with Cream Cheese',   serving: '1 bagel',  cal: 430, p: 15, c: 71, f: 11, fiber: 3, sugar: 8,  satFat: 6,  sodium: 810 },
    ],
  },
  {
    id: 'barns', name: "Barn's", category: 'Coffee & Desserts',
    items: [
      { id: 'bn1', name: 'Arabic Coffee',             serving: '1 cup',    cal: 5,   p: 0,  c: 1,  f: 0,  fiber: 0, sugar: 0,  satFat: 0, sodium: 5   },
      { id: 'bn2', name: 'Iced Latte',                serving: '1 medium', cal: 180, p: 9,  c: 18, f: 7,  fiber: 0, sugar: 17, satFat: 4, sodium: 120 },
      { id: 'bn3', name: 'Spanish Latte',             serving: '1 medium', cal: 310, p: 10, c: 42, f: 10, fiber: 0, sugar: 39, satFat: 6, sodium: 150 },
      { id: 'bn4', name: 'Mocha',                     serving: '1 medium', cal: 340, p: 10, c: 48, f: 12, fiber: 1, sugar: 43, satFat: 7, sodium: 170 },
      { id: 'bn5', name: 'Chocolate Muffin',          serving: '1 muffin', cal: 420, p: 6,  c: 58, f: 18, fiber: 2, sugar: 34, satFat: 7, sodium: 360 },
      { id: 'bn6', name: 'Cheese Croissant',          serving: '1 piece',  cal: 330, p: 10, c: 32, f: 18, fiber: 1, sugar: 5,  satFat: 10,sodium: 430 },
    ],
  },
  {
    id: 'halfmillion', name: 'Half Million', category: 'Coffee & Desserts',
    items: [
      { id: 'hm1', name: 'Iced Spanish Latte',        serving: '1 medium', cal: 320, p: 10, c: 44, f: 11, fiber: 0, sugar: 41, satFat: 6, sodium: 150 },
      { id: 'hm2', name: 'Hot Latte',                 serving: '1 medium', cal: 190, p: 10, c: 18, f: 8,  fiber: 0, sugar: 17, satFat: 5, sodium: 130 },
      { id: 'hm3', name: 'Americano',                 serving: '1 medium', cal: 10,  p: 0,  c: 2,  f: 0,  fiber: 0, sugar: 0,  satFat: 0, sodium: 5   },
      { id: 'hm4', name: 'Pistachio Latte',           serving: '1 medium', cal: 390, p: 11, c: 48, f: 17, fiber: 1, sugar: 42, satFat: 8, sodium: 190 },
      { id: 'hm5', name: 'Chocolate Cookie',          serving: '1 cookie', cal: 260, p: 3,  c: 34, f: 13, fiber: 2, sugar: 22, satFat: 7, sodium: 180 },
      { id: 'hm6', name: 'Mini Donut',                serving: '1 piece',  cal: 130, p: 2,  c: 17, f: 6,  fiber: 1, sugar: 9,  satFat: 3, sodium: 90  },
    ],
  },
  {
    id: 'dominos', name: "Domino's", category: 'Fast Food',
    items: [
      { id: 'dm1', name: 'Hand Tossed Cheese Slice',        serving: '1 slice', cal: 210, p: 9,  c: 27, f: 8,  fiber: 1, sugar: 2, satFat: 4, sodium: 480 },
      { id: 'dm2', name: 'Pepperoni Pizza Slice',           serving: '1 slice', cal: 260, p: 11, c: 28, f: 12, fiber: 1, sugar: 2, satFat: 5, sodium: 620 },
      { id: 'dm3', name: 'Chicken Legend Slice',            serving: '1 slice', cal: 280, p: 13, c: 30, f: 12, fiber: 1, sugar: 3, satFat: 5, sodium: 640 },
      { id: 'dm4', name: 'Stuffed Cheesy Bread',            serving: '2 pieces',cal: 300, p: 11, c: 34, f: 14, fiber: 1, sugar: 2, satFat: 7, sodium: 700 },
      { id: 'dm5', name: 'Chicken Kickers',                 serving: '6 pieces',cal: 360, p: 24, c: 24, f: 18, fiber: 1, sugar: 1, satFat: 4, sodium: 880 },
      { id: 'dm6', name: 'Chocolate Lava Cake',             serving: '1 cake',  cal: 350, p: 4,  c: 46, f: 18, fiber: 2, sugar: 31,satFat: 10,sodium: 250 },
    ],
  },
  {
    id: 'hardees', name: "Hardee's", category: 'Fast Food',
    items: [
      { id: 'hd1', name: 'Super Star Burger',          serving: '1 burger', cal: 740, p: 42, c: 44, f: 46, fiber: 2, sugar: 10, satFat: 18, sodium: 1240 },
      { id: 'hd2', name: 'Famous Star Burger',         serving: '1 burger', cal: 620, p: 31, c: 43, f: 36, fiber: 2, sugar: 9,  satFat: 14, sodium: 1050 },
      { id: 'hd3', name: 'Chicken Fillet Sandwich',    serving: '1 sandwich',cal: 520,p: 28, c: 48, f: 23, fiber: 2, sugar: 6,  satFat: 5,  sodium: 980  },
      { id: 'hd4', name: 'Curly Fries',                serving: '1 regular', cal: 360, p: 5,  c: 42, f: 19, fiber: 4, sugar: 1,  satFat: 4,  sodium: 760  },
      { id: 'hd5', name: 'Chicken Tenders 3pc',        serving: '3 pieces',  cal: 330, p: 26, c: 22, f: 16, fiber: 1, sugar: 0,  satFat: 3,  sodium: 820  },
      { id: 'hd6', name: 'Chocolate Shake',            serving: '1 medium',  cal: 590, p: 13, c: 82, f: 23, fiber: 2, sugar: 70, satFat: 14, sodium: 360  },
    ],
  },
  {
    id: 'kcal', name: 'Kcal', category: 'Healthy',
    items: [
      { id: 'kc1', name: 'Grilled Chicken Bowl',    serving: '1 bowl',   cal: 380, p: 42, c: 28, f: 10, fiber: 5, sugar: 4,  satFat: 2, sodium: 520 },
      { id: 'kc2', name: 'Salmon Bowl',              serving: '1 bowl',   cal: 420, p: 38, c: 30, f: 14, fiber: 5, sugar: 4,  satFat: 3, sodium: 560 },
      { id: 'kc3', name: 'Veggie Wrap',              serving: '1 wrap',   cal: 340, p: 14, c: 46, f: 12, fiber: 6, sugar: 6,  satFat: 2, sodium: 480 },
      { id: 'kc4', name: 'Protein Pancakes',         serving: '1 plate',  cal: 380, p: 28, c: 42, f: 10, fiber: 3, sugar: 8,  satFat: 2, sodium: 340 },
      { id: 'kc5', name: 'Acai Bowl',                serving: '1 bowl',   cal: 320, p: 8,  c: 52, f: 8,  fiber: 8, sugar: 28, satFat: 2, sodium: 120 },
      { id: 'kc6', name: 'Power Salad',              serving: '1 salad',  cal: 290, p: 22, c: 20, f: 13, fiber: 6, sugar: 6,  satFat: 2, sodium: 380 },
      { id: 'kc7', name: 'Beef Burger (Lean)',        serving: '1 burger', cal: 420, p: 38, c: 30, f: 16, fiber: 3, sugar: 4,  satFat: 5, sodium: 620 },
      { id: 'kc8', name: 'Chocolate Protein Shake',  serving: '1 cup',    cal: 280, p: 30, c: 22, f: 8,  fiber: 2, sugar: 12, satFat: 2, sodium: 220 },
    ],
  },
  {
    id: 'rightbite', name: 'Right Bite', category: 'Healthy',
    items: [
      { id: 'rb1', name: 'Grilled Chicken & Quinoa',  serving: '1 meal',  cal: 350, p: 38, c: 30, f: 9,  fiber: 4, sugar: 3,  satFat: 2, sodium: 480 },
      { id: 'rb2', name: 'Salmon Fillet & Veggies',   serving: '1 meal',  cal: 320, p: 35, c: 12, f: 16, fiber: 4, sugar: 4,  satFat: 3, sodium: 420 },
      { id: 'rb3', name: 'Green Chicken Salad',        serving: '1 salad', cal: 280, p: 28, c: 14, f: 10, fiber: 5, sugar: 5,  satFat: 2, sodium: 360 },
      { id: 'rb4', name: 'Overnight Oats',             serving: '1 jar',   cal: 310, p: 12, c: 48, f: 8,  fiber: 5, sugar: 18, satFat: 1, sodium: 180 },
      { id: 'rb5', name: 'Turkey Stuffed Peppers',     serving: '1 meal',  cal: 290, p: 26, c: 22, f: 10, fiber: 5, sugar: 8,  satFat: 3, sodium: 520 },
      { id: 'rb6', name: 'Protein Smoothie',           serving: '1 cup',   cal: 240, p: 24, c: 26, f: 6,  fiber: 3, sugar: 16, satFat: 1, sodium: 160 },
    ],
  },
  {
    id: 'calo', name: 'Calo', category: 'Healthy',
    items: [
      { id: 'cl1', name: 'Chicken Power Bowl',          serving: '1 bowl', cal: 430, p: 44, c: 36, f: 12, fiber: 6, sugar: 5, satFat: 3, sodium: 560 },
      { id: 'cl2', name: 'Beef & Rice Bowl',            serving: '1 bowl', cal: 520, p: 42, c: 48, f: 18, fiber: 5, sugar: 4, satFat: 6, sodium: 680 },
      { id: 'cl3', name: 'Salmon Quinoa Plate',         serving: '1 plate',cal: 490, p: 38, c: 34, f: 22, fiber: 5, sugar: 4, satFat: 4, sodium: 520 },
      { id: 'cl4', name: 'Turkey Wrap',                 serving: '1 wrap', cal: 360, p: 30, c: 38, f: 10, fiber: 5, sugar: 5, satFat: 2, sodium: 620 },
      { id: 'cl5', name: 'Protein Pancakes',            serving: '1 plate',cal: 390, p: 30, c: 44, f: 10, fiber: 4, sugar: 10,satFat: 2, sodium: 360 },
      { id: 'cl6', name: 'Overnight Protein Oats',      serving: '1 cup',  cal: 330, p: 24, c: 46, f: 7,  fiber: 7, sugar: 14,satFat: 1, sodium: 180 },
    ],
  },
  {
    id: 'dietcenter', name: 'Diet Center', category: 'Healthy',
    items: [
      { id: 'dc1', name: 'Grilled Chicken Breast Meal', serving: '1 meal', cal: 360, p: 42, c: 28, f: 9,  fiber: 4, sugar: 3, satFat: 2, sodium: 480 },
      { id: 'dc2', name: 'Lean Beef Meal',              serving: '1 meal', cal: 430, p: 38, c: 32, f: 16, fiber: 4, sugar: 4, satFat: 5, sodium: 560 },
      { id: 'dc3', name: 'Chicken Caesar Salad',        serving: '1 salad',cal: 310, p: 32, c: 12, f: 15, fiber: 4, sugar: 3, satFat: 4, sodium: 620 },
      { id: 'dc4', name: 'Low Carb Chicken Plate',      serving: '1 plate',cal: 290, p: 40, c: 10, f: 10, fiber: 5, sugar: 4, satFat: 2, sodium: 460 },
      { id: 'dc5', name: 'Tuna Pasta Salad',            serving: '1 bowl', cal: 380, p: 28, c: 42, f: 11, fiber: 5, sugar: 5, satFat: 2, sodium: 520 },
      { id: 'dc6', name: 'Protein Cheesecake Cup',      serving: '1 cup',  cal: 220, p: 20, c: 18, f: 8,  fiber: 2, sugar: 8, satFat: 4, sodium: 180 },
    ],
  },
];

const RESTAURANTS_DB = [
  {
    id: 'mcdonalds_riyadh_verified',
    name: "McDonald's Riyadh",
    category: 'Fast Food',
    verified: true,
    source: 'official_mcdonalds_saudi',
    items: [
      {
        id: 'mcd_riy_bigmac',
        name: 'Big Mac',
        serving: '225g',
        cal: 603, p: 23, c: 53, f: 31,
        fiber: 4, sugar: 10, satFat: 12, sodium: 944,
        verified: true,
        sourceUrl: 'https://www.mcdonalds.com/sa/en-sa/riyadh/product/big-mac.html',
      },
      {
        id: 'mcd_riy_mcchicken',
        name: 'McChicken',
        serving: '181g',
        cal: 453, p: 17, c: 49, f: 21,
        fiber: 3, sugar: 6, satFat: 4, sodium: 745,
        verified: true,
        sourceUrl: 'https://www.mcdonalds.com/sa/en-sa/riyadh/product/mcchicken.html',
      },
      {
        id: 'mcd_riy_quarter',
        name: 'Quarter Pounder',
        serving: '195g',
        cal: 523, p: 32, c: 42, f: 25,
        fiber: 2, sugar: 9, satFat: 14, sodium: 1228,
        verified: true,
        sourceUrl: 'https://www.mcdonalds.com/sa/ar-sa/riyadh/product/quarter-pounder.html',
      },
      {
        id: 'mcd_riy_bigtasty',
        name: 'Big Tasty',
        serving: '343g',
        cal: 870, p: 45, c: 61, f: 50,
        fiber: 4, sugar: 13, satFat: 22, sodium: 1677,
        verified: true,
        sourceUrl: 'https://www.mcdonalds.com/sa/en-sa/riyadh/product/big-tasty.html',
      },
      {
        id: 'mcd_riy_filet',
        name: 'Filet-O-Fish',
        serving: '139g',
        cal: 346, p: 14, c: 41, f: 14,
        fiber: 2, sugar: 5, satFat: 5, sodium: 640,
        verified: true,
        sourceUrl: 'https://www.mcdonalds.com/sa/en-sa/riyadh/product/filet-o-fish.html',
      },
      {
        id: 'mcd_riy_9nuggets_meal',
        name: '9 Pcs Chicken McNuggets Meal',
        serving: '835g',
        cal: 737, p: 30, c: 70, f: 38,
        fiber: 8, sugar: 1, satFat: 5, sodium: 1177,
        verified: true,
        sourceUrl: 'https://www.mcdonalds.com/sa/en-sa/riyadh/meal/9pcs-chicken-mcnuggets-meal.html',
      },
      {
        id: 'mcd_riy_bigtasty_meal',
        name: 'Big Tasty Meal',
        serving: '1029g',
        cal: 1252, p: 52, c: 108, f: 69,
        fiber: 10, sugar: 14, satFat: 24, sodium: 2178,
        verified: true,
        sourceUrl: 'https://www.mcdonalds.com/sa/en-sa/riyadh/meal/big-tasty-meal.html',
      },
    ],
  },
];

// flatten for search
const RESTAURANT_ITEMS_FLAT = RESTAURANTS_DB.flatMap(r =>
  r.items.map(item => ({ ...item, brand: r.name, _restaurantId: r.id }))
);

const AF_TABS    = ['All', 'Restaurants', 'My Foods'];
const AF_ACTIONS = [
  { icon: 'barcode-outline',  label: 'Barcode scan', key: 'barcode' },
  { icon: 'camera-outline',   label: 'AI meal scan', key: 'meal'    },
  { icon: 'add-circle-outline', label: 'Create food', key: 'create' },
];

const EMPTY_FOOD = { name: '', brand: '', serving: '100g', cal: '', p: '', c: '', f: '', fiber: '', sugar: '', satFat: '', sodium: '' };
const FOOD_SEARCH_ALIASES = [
  ['almarai', 'المراعي'],
  ['al marai', 'المراعي'],
  ['al-marai', 'المراعي'],
  ['المراعي', 'almarai'],
  ['المراعي', 'al marai'],
  ['nadec', 'نادك'],
  ['nadc', 'نادك'],
  ['nadek', 'نادك'],
  ['naadec', 'نادك'],
  ['نادك', 'nadec'],
  ['نادك', 'nadc'],
  ['nada', 'ندى'],
  ['ندى', 'nada'],
  ['saudia', 'السعودية'],
  ['saudi dairy', 'السعودية'],
  ['السعودية', 'saudia'],
  ['الصافي', 'alsafi'],
  ['safi', 'الصافي'],
  ['alsafi', 'الصافي'],
  ['المراعي لوزين', 'lusine'],
  ['لوزين', 'lusine'],
  ['lusine', 'لوزين'],
  ['americana', 'امريكانا'],
  ['أمريكانا', 'americana'],
  ['امريكانا', 'americana'],
  ['herfy', 'هرفي'],
  ['هرفي', 'herfy'],
  ['maestro', 'مايسترو'],
  ['مايسترو', 'maestro'],
  ['barns', 'بارنز'],
  ['barn s', 'بارنز'],
  ['بارنز', 'barns'],
  ['kudu', 'كودو'],
  ['كودو', 'kudu'],
  ['albaik', 'البيك'],
  ['al baik', 'البيك'],
  ['البيك', 'albaik'],
  ['pepsi', 'بيبسي'],
  ['بيبسي', 'pepsi'],
  ['coca cola', 'كوكا كولا'],
  ['كوكا كولا', 'coca cola'],
  ['kitkat', 'كيت كات'],
  ['kit kat', 'كيت كات'],
  ['كيت كات', 'kit kat'],
  ['twix', 'تويكس'],
  ['تويكس', 'twix'],
  ['al rabie', 'الربيع'],
  ['alrabie', 'الربيع'],
  ['الربيع', 'al rabie'],
  ['al rawabi', 'الروابي'],
  ['alrawabi', 'الروابي'],
  ['الروابي', 'al rawabi'],
  ['luna', 'لونا'],
  ['لونا', 'luna'],
  ['puck', 'بوك'],
  ['بوك', 'puck'],
  ['kraft', 'كرافت'],
  ['كرافت', 'kraft'],
  ['kiri', 'كيري'],
  ['كيري', 'kiri'],
  ['the laughing cow', 'البقرة الضاحكة'],
  ['laughing cow', 'البقرة الضاحكة'],
  ['البقرة الضاحكة', 'laughing cow'],
  ['danone', 'دانون'],
  ['دانون', 'danone'],
  ['activia', 'اكتيفيا'],
  ['اكتيفيا', 'activia'],
  ['actimel', 'اكتيميل'],
  ['اكتيميل', 'actimel'],
  ['arla', 'ارلا'],
  ['ارلا', 'arla'],
  ['president', 'بريزيدن'],
  ['بريزيدن', 'president'],
  ['anchor', 'انكور'],
  ['انكور', 'anchor'],
  ['nestle', 'نستله'],
  ['نستله', 'nestle'],
  ['nescafe', 'نسكافيه'],
  ['نسكافيه', 'nescafe'],
  ['milo', 'ميلو'],
  ['ميلو', 'milo'],
  ['nesquik', 'نسكويك'],
  ['نسكويك', 'nesquik'],
  ['lipton', 'ليبتون'],
  ['ليبتون', 'lipton'],
  ['twinings', 'تويننجز'],
  ['تويننجز', 'twinings'],
  ['starbucks', 'ستاربكس'],
  ['ستاربكس', 'starbucks'],
  ['costa', 'كوستا'],
  ['كوستا', 'costa'],
  ['dunkin', 'دانكن'],
  ['dunkin donuts', 'دانكن دونتس'],
  ['دانكن', 'dunkin'],
  ['دانكن دونتس', 'dunkin donuts'],
  ['kinza', 'كينزا'],
  ['كينزا', 'kinza'],
  ['mirinda', 'ميرندا'],
  ['ميرندا', 'mirinda'],
  ['7up', 'سفن اب'],
  ['seven up', 'سفن اب'],
  ['سفن اب', '7up'],
  ['mountain dew', 'ماونتن ديو'],
  ['ماونتن ديو', 'mountain dew'],
  ['red bull', 'ريد بل'],
  ['ريد بل', 'red bull'],
  ['power horse', 'باور هورس'],
  ['باور هورس', 'power horse'],
  ['barbican', 'باربيكان'],
  ['باربيكان', 'barbican'],
  ['rani', 'راني'],
  ['راني', 'rani'],
  ['vimto', 'فيمتو'],
  ['فيمتو', 'vimto'],
  ['sun top', 'سن توب'],
  ['suntop', 'سن توب'],
  ['سن توب', 'sun top'],
  ['sunquick', 'سن كويك'],
  ['سن كويك', 'sunquick'],
  ['tang', 'تانج'],
  ['تانج', 'tang'],
  ['aquafina', 'اكوافينا'],
  ['اكوافينا', 'aquafina'],
  ['nova', 'نوفا'],
  ['نوفا', 'nova'],
  ['berain', 'بيرين'],
  ['بيرين', 'berain'],
  ['huda', 'هدى'],
  ['هدى', 'huda'],
  ['evian', 'ايفيان'],
  ['ايفيان', 'evian'],
  ['volvic', 'فولفيك'],
  ['فولفيك', 'volvic'],
  ['perrier', 'بيرييه'],
  ['بيرييه', 'perrier'],
  ['lays', 'ليز'],
  ['ليز', 'lays'],
  ['doritos', 'دوريتوس'],
  ['دوريتوس', 'doritos'],
  ['cheetos', 'شيتوس'],
  ['شيتوس', 'cheetos'],
  ['pringles', 'برينجلز'],
  ['برينجلز', 'pringles'],
  ['bugles', 'بوقلز'],
  ['بوقلز', 'bugles'],
  ['takis', 'تاكيس'],
  ['تاكيس', 'takis'],
  ['ritz', 'ريتز'],
  ['ريتز', 'ritz'],
  ['oreo', 'اوريو'],
  ['اوريو', 'oreo'],
  ['loacker', 'لواكر'],
  ['لواكر', 'loacker'],
  ['ulker', 'اولكر'],
  ['اولكر', 'ulker'],
  ['mcvities', 'مكفيتيز'],
  ['mc vities', 'مكفيتيز'],
  ['مكفيتيز', 'mcvities'],
  ['tiffany', 'تيفاني'],
  ['تيفاني', 'tiffany'],
  ['galaxy', 'جالكسي'],
  ['جالكسي', 'galaxy'],
  ['snickers', 'سنيكرز'],
  ['سنيكرز', 'snickers'],
  ['mars', 'مارس'],
  ['مارس', 'mars'],
  ['bounty', 'باونتي'],
  ['باونتي', 'bounty'],
  ['maltesers', 'مالتيزرز'],
  ['مالتيزرز', 'maltesers'],
  ['m and m', 'ام اند امز'],
  ['m&m', 'ام اند امز'],
  ['ام اند امز', 'm&m'],
  ['cadbury', 'كادبوري'],
  ['كادبوري', 'cadbury'],
  ['lindt', 'ليندت'],
  ['ليندت', 'lindt'],
  ['ferrero rocher', 'فيريرو روشيه'],
  ['فيريرو روشيه', 'ferrero rocher'],
  ['kinder', 'كيندر'],
  ['كيندر', 'kinder'],
  ['hersheys', 'هيرشيز'],
  ['هيرشيز', 'hersheys'],
  ['reese', 'ريسيز'],
  ['ريسيز', 'reese'],
  ['ben and jerrys', 'بن اند جيريز'],
  ['ben jerrys', 'بن اند جيريز'],
  ['بن اند جيريز', 'ben and jerrys'],
  ['haagen dazs', 'هاجن داز'],
  ['هاجن داز', 'haagen dazs'],
  ['baskin robbins', 'باسكن روبنز'],
  ['باسكن روبنز', 'baskin robbins'],
  ['london dairy', 'لندن ديري'],
  ['لندن ديري', 'london dairy'],
  ['americana cake', 'امريكانا كيك'],
  ['امريكانا كيك', 'americana cake'],
  ['sadia', 'ساديا'],
  ['ساديا', 'sadia'],
  ['al watania', 'الوطنية'],
  ['الوطنية', 'al watania'],
  ['fakieh', 'فقيه'],
  ['فقيه', 'fakieh'],
  ['tanmiah', 'تنمية'],
  ['تنمية', 'tanmiah'],
  ['alyoum', 'اليوم'],
  ['al youm', 'اليوم'],
  ['اليوم', 'alyoum'],
  ['naqi', 'نقي'],
  ['نقي', 'naqi'],
  ['goody', 'قودي'],
  ['قودي', 'goody'],
  ['heinz', 'هاينز'],
  ['هاينز', 'heinz'],
  ['hellmanns', 'هيلمانز'],
  ['هيلمانز', 'hellmanns'],
  ['maggi', 'ماجي'],
  ['ماجي', 'maggi'],
  ['knorr', 'كنور'],
  ['كنور', 'knorr'],
  ['quaker', 'كويكر'],
  ['كويكر', 'quaker'],
  ['weetabix', 'ويتابكس'],
  ['ويتابكس', 'weetabix'],
  ['kelloggs', 'كيلوقز'],
  ['كيلوقز', 'kelloggs'],
  ['fitness cereal', 'فتنس'],
  ['فتنس', 'fitness cereal'],
  ['nature valley', 'نيتشر فالي'],
  ['نيتشر فالي', 'nature valley'],
  ['quest', 'كويست'],
  ['كويست', 'quest'],
  ['grenade', 'جرينيد'],
  ['جرينيد', 'grenade'],
  ['optimum nutrition', 'اوبتيموم نيوترشن'],
  ['on protein', 'اوبتيموم نيوترشن'],
  ['اوبتيموم نيوترشن', 'optimum nutrition'],
  ['myprotein', 'ماي بروتين'],
  ['ماي بروتين', 'myprotein'],
  ['isopure', 'ايزوبور'],
  ['ايزوبور', 'isopure'],
  ['muscle tech', 'مسل تك'],
  ['مسل تك', 'muscle tech'],
  ['subway', 'صب واي'],
  ['صب واي', 'subway'],
  ['mcdonalds', 'ماكدونالدز'],
  ['ماكدونالدز', 'mcdonalds'],
  ['burger king', 'برجر كنج'],
  ['برجر كنج', 'burger king'],
  ['kfc', 'كنتاكي'],
  ['كنتاكي', 'kfc'],
  ['pizza hut', 'بيتزا هت'],
  ['بيتزا هت', 'pizza hut'],
  ['dominos', 'دومينوز'],
  ['دومينوز', 'dominos'],
  ['papa johns', 'بابا جونز'],
  ['بابا جونز', 'papa johns'],
  ['shawarma house', 'بيت الشاورما'],
  ['بيت الشاورما', 'shawarma house'],
  ['shrimp nation', 'شرمب نيشن'],
  ['شرمب نيشن', 'shrimp nation'],
  ['half million', 'هاف مليون'],
  ['هاف مليون', 'half million'],
  ['dose cafe', 'دوز كافيه'],
  ['دوز كافيه', 'dose cafe'],
  ['dr cafe', 'دكتور كيف'],
  ['دكتور كيف', 'dr cafe'],
  ['حليب', 'milk'],
  ['لبن', 'milk'],
  ['زبادي', 'yogurt'],
  ['زبادى', 'yogurt'],
  ['لبنة', 'labneh'],
  ['جبن', 'cheese'],
  ['جبنة', 'cheese'],
  ['شرائح جبن', 'cheese slices'],
  ['جبن شرائح', 'cheese slices'],
  ['قشطة', 'cream'],
  ['كريمة', 'cream'],
  ['زبدة', 'butter'],
  ['سمن', 'ghee'],
  ['عصير', 'juice'],
  ['ماء', 'water'],
  ['مياه', 'water'],
  ['مشروب', 'drink'],
  ['مشروبات', 'drinks'],
  ['غازي', 'soda'],
  ['مشروب غازي', 'soda'],
  ['صودا', 'soda'],
  ['قهوة', 'coffee'],
  ['شاي', 'tea'],
  ['كابتشينو', 'cappuccino'],
  ['لاتيه', 'latte'],
  ['لبن رائب', 'laban'],
  ['لبن زبادي', 'yogurt'],
  ['خبز', 'bread'],
  ['توست', 'toast'],
  ['صامولي', 'samoli bread'],
  ['برجر', 'burger'],
  ['خبز برجر', 'burger bun'],
  ['تورتيلا', 'tortilla'],
  ['بيتا', 'pita'],
  ['رقائق', 'chips'],
  ['شيبس', 'chips'],
  ['بطاطس', 'potato'],
  ['بطاطا', 'potato'],
  ['بطاطس مقلية', 'fries'],
  ['مقرمشات', 'snacks'],
  ['بسكويت', 'biscuits'],
  ['كوكيز', 'cookies'],
  ['كيك', 'cake'],
  ['شوكولاتة', 'chocolate'],
  ['شوكولاته', 'chocolate'],
  ['حلاوة', 'sweet'],
  ['حلى', 'dessert'],
  ['آيس كريم', 'ice cream'],
  ['ايس كريم', 'ice cream'],
  ['ايسكريم', 'ice cream'],
  ['نوتيلا', 'nutella'],
  ['دجاج', 'chicken'],
  ['فراخ', 'chicken'],
  ['لحم', 'beef'],
  ['لحم بقري', 'beef'],
  ['غنم', 'lamb'],
  ['لحم غنم', 'lamb'],
  ['سمك', 'fish'],
  ['سلمون', 'salmon'],
  ['روبيان', 'shrimp'],
  ['بيض', 'eggs'],
  ['تونة', 'tuna'],
  ['تمر', 'dates'],
  ['شوفان', 'oats'],
  ['بروتين', 'protein'],
  ['واي بروتين', 'whey protein'],
  ['رز', 'rice'],
  ['أرز', 'rice'],
  ['ارز', 'rice'],
  ['مكرونة', 'pasta'],
  ['باستا', 'pasta'],
  ['نودلز', 'noodles'],
  ['شوربة', 'soup'],
  ['فول', 'beans'],
  ['حمص', 'hummus'],
  ['عدس', 'lentils'],
  ['فاصوليا', 'beans'],
  ['ذرة', 'corn'],
  ['خضار', 'vegetables'],
  ['خضروات', 'vegetables'],
  ['سلطة', 'salad'],
  ['فاكهة', 'fruit'],
  ['فواكه', 'fruit'],
  ['موز', 'banana'],
  ['تفاح', 'apple'],
  ['برتقال', 'orange'],
  ['مانجو', 'mango'],
  ['فراولة', 'strawberry'],
  ['عنب', 'grapes'],
  ['رمان', 'pomegranate'],
  ['زيت', 'oil'],
  ['زيت زيتون', 'olive oil'],
  ['مايونيز', 'mayonnaise'],
  ['كاتشب', 'ketchup'],
  ['صلصة', 'sauce'],
  ['صوص', 'sauce'],
  ['شطة', 'hot sauce'],
  ['حار', 'spicy'],
  ['ملح', 'salt'],
  ['سكر', 'sugar'],
  ['عسل', 'honey'],
  ['مربى', 'jam'],
  ['زبدة فول سوداني', 'peanut butter'],
  ['فول سوداني', 'peanut'],
  ['لوز', 'almond'],
  ['كاجو', 'cashew'],
  ['فستق', 'pistachio'],
  ['مكسرات', 'nuts'],
  ['كامل الدسم', 'full fat'],
  ['قليل الدسم', 'low fat'],
  ['خالي الدسم', 'skimmed'],
  ['لايت', 'light'],
  ['دايت', 'diet'],
  ['عضوي', 'organic'],
  ['مجمد', 'frozen'],
  ['طازج', 'fresh'],
  ['معلب', 'canned'],
  ['بودرة', 'powder'],
  ['كيس', 'bag'],
  ['علبة', 'can'],
  ['عبوة', 'pack'],
  ['قارورة', 'bottle'],
  ['زجاجة', 'bottle'],
  ['كوب', 'cup'],
  ['قطعة', 'piece'],
  ['حبة', 'piece'],
  ['شريحة', 'slice'],
  ['بار', 'bar'],
];

const normalizeFoodSearch = (value) => String(value || '')
  .toLowerCase()
  .replace(/[إأآٱ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/[ً-ْ]/g, '')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const expandedFoodQueries = (query) => {
  const q = normalizeFoodSearch(query);
  if (!q) return [];

  const aliases = FOOD_SEARCH_ALIASES.map(([from, to]) => [
    normalizeFoodSearch(from),
    normalizeFoodSearch(to),
  ]);
  const seen = new Set([q]);
  let frontier = [q];

  for (let depth = 0; depth < 3; depth += 1) {
    const next = [];
    frontier.forEach(current => {
      aliases.forEach(([from, to]) => {
        if (!from || !to || !current.includes(from)) return;
        const replaced = normalizeFoodSearch(current.replace(from, to));
        if (replaced && !seen.has(replaced)) {
          seen.add(replaced);
          next.push(replaced);
        }
        if (!seen.has(to)) {
          seen.add(to);
          next.push(to);
        }
      });
    });
    if (!next.length) break;
    frontier = next;
    if (seen.size >= 80) {
      break;
    }
  }

  const hasArabic = value => /[\u0600-\u06FF]/.test(value);
  const wordCount = value => value.split(' ').filter(Boolean).length;
  const ordered = [...seen].filter(Boolean);
  const rest = ordered
    .filter(value => value !== q)
    .sort((a, b) => {
      const aArabic = hasArabic(a) ? 1 : 0;
      const bArabic = hasArabic(b) ? 1 : 0;
      if (aArabic !== bArabic) return aArabic - bArabic;
      return wordCount(b) - wordCount(a);
    });
  return [q, ...rest].slice(0, 10);
};

function servingOptionsFor(serving) {
  const base = serving || '1 serving';
  const normalized = String(base).replace(/\s+/g, ' ').trim();
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(g|gram|grams|ml|mL|milliliter|milliliters)\b/i);
  const options = [];
  const add = (label, mult) => {
    if (!options.some(opt => opt.label === label)) options.push({ label, mult });
  };

  if (match) {
    const qty = parseFloat(match[1]);
    const rawUnit = match[2].toLowerCase();
    const unit = rawUnit.startsWith('m') ? 'ml' : 'g';
    const unitLabelText = (amount) => unit === 'g' ? `${amount}g` : `${amount} ml`;
    add(unitLabelText(1), 1 / qty);
    if (qty > 10) add(unitLabelText(10), 10 / qty);
    if (qty > 25) add(unitLabelText(25), 25 / qty);
    add('1/4 serving', 0.25);
    add('1/2 serving', 0.5);
    add(normalized, 1);
    add('2 servings', 2);
    return options;
  }

  add('1/4 serving', 0.25);
  add('1/2 serving', 0.5);
  add(normalized, 1);
  add('2 servings', 2);
  return options;
}

// ── SWIPEABLE ROW ─────────────────────────────────────────
function SwipeableRow({ onDelete, disabled = false, children }) {
  const translateX  = useRef(new Animated.Value(0)).current;
  const onDeleteRef = useRef(onDelete);
  const deletedRef  = useRef(false);
  useEffect(() => { onDeleteRef.current = onDelete; }, [onDelete]);

  const clampedX = translateX.interpolate({
    inputRange: [-500, 0], outputRange: [-500, 0], extrapolate: 'clamp',
  });
  const bgOpacity = translateX.interpolate({
    inputRange: [-80, -10, 0], outputRange: [1, 0.5, 0], extrapolate: 'clamp',
  });
  const iconScale = translateX.interpolate({
    inputRange: [-120, -30, 0], outputRange: [1.4, 0.8, 0.3], extrapolate: 'clamp',
  });
  const iconShift = translateX.interpolate({
    inputRange: [-120, 0], outputRange: [0, 18], extrapolate: 'clamp',
  });

  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetX([-10, 5])
    .failOffsetY([-12, 12])
    .runOnJS(true)
    .onBegin(() => { deletedRef.current = false; })
    .onUpdate((e) => { if (e.translationX < 0) translateX.setValue(e.translationX); })
    .onEnd((e) => {
      if (e.translationX < -80) {
        deletedRef.current = true;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        Animated.timing(translateX, { toValue: -500, duration: 180, useNativeDriver: true })
          .start(() => onDeleteRef.current?.());
      } else {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
      }
    })
    .onFinalize(() => {
      if (!deletedRef.current) Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
    }), []);

  return (
    <View style={{ overflow: 'hidden' }}>
      <Animated.View style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, left: 0,
        backgroundColor: '#FF375F',
        alignItems: 'flex-end', justifyContent: 'center', paddingRight: 22,
        opacity: bgOpacity,
      }}>
        <Animated.View style={{ transform: [{ scale: iconScale }, { translateX: iconShift }] }}>
          <Ionicons name="trash" size={26} color="#fff" />
        </Animated.View>
      </Animated.View>

      {disabled ? (
        <View>{children}</View>
      ) : (
        <GestureDetector gesture={pan}>
          <Animated.View style={{ transform: [{ translateX: clampedX }] }}>
            {children}
          </Animated.View>
        </GestureDetector>
      )}
    </View>
  );
}

function RingProgress({ size, stroke, progress, color, trackColor }) {
  const p    = Math.min(Math.max(progress || 0, 0), 1);
  const r    = (size - stroke) / 2;
  const cx   = size / 2;
  const circ = 2 * Math.PI * r;
  const track = trackColor ?? 'rgba(255,255,255,0.10)';
  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle cx={cx} cy={cx} r={r} stroke={track}  strokeWidth={stroke} fill="none" />
      <Circle cx={cx} cy={cx} r={r} stroke={color}  strokeWidth={stroke} fill="none"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - p)}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function AnimatedRingProgress({ size, stroke, progress, color, trackColor }) {
  const target = Math.min(Math.max(progress || 0, 0), 1);
  const [displayP, setDisplayP] = useState(0);
  const animRef = useRef(new Animated.Value(0));
  const r    = (size - stroke) / 2;
  const cx   = size / 2;
  const circ = 2 * Math.PI * r;
  const track = trackColor ?? 'rgba(255,255,255,0.10)';
  useEffect(() => {
    animRef.current.setValue(0);
    const id = animRef.current.addListener(({ value }) => setDisplayP(value));
    Animated.timing(animRef.current, { toValue: target, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(() => animRef.current.removeListener(id));
    return () => animRef.current.removeListener(id);
  }, [target]);
  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle cx={cx} cy={cx} r={r} stroke={track} strokeWidth={stroke} fill="none" />
      <Circle cx={cx} cy={cx} r={r} stroke={color} strokeWidth={stroke} fill="none"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - displayP)}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function MacroBar({ p = 0, c = 0, f = 0 }) {
  const total = (p || 0) * 4 + (c || 0) * 4 + (f || 0) * 9;
  if (total === 0) return null;
  return (
    <View style={{ height: 3, flexDirection: 'row', borderRadius: 2, overflow: 'hidden', marginTop: 7 }}>
      <View style={{ flex: (p * 4) / total, backgroundColor: '#FFB340' }} />
      <View style={{ flex: (c * 4) / total, backgroundColor: '#30D158' }} />
      <View style={{ flex: (f * 9) / total, backgroundColor: '#BF5AF2' }} />
    </View>
  );
}

function MacroCaloriesRing({ cal, p, c, f, size = 76 }) {
  const C = useContext(ThemeContext);
  const bsStyles = mkBsStyles(C);
  const stroke = 8;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const circ = 2 * Math.PI * r;
  const macroCals = Math.max((p || 0) * 4 + (c || 0) * 4 + (f || 0) * 9, 1);
  const segments = [
    { key: 'carbs', color: '#30D158', pct: ((c || 0) * 4) / macroCals },
    { key: 'fat', color: '#BF5AF2', pct: ((f || 0) * 9) / macroCals },
    { key: 'protein', color: '#FFB340', pct: ((p || 0) * 4) / macroCals },
  ];
  let offset = 0;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={cx} cy={cx} r={r} stroke={C.s3} strokeWidth={stroke} fill="none" />
        {segments.map(seg => {
          const dash = `${Math.max(seg.pct * circ, 0)} ${circ}`;
          const dashOffset = -offset * circ;
          offset += seg.pct;
          return (
            <Circle
              key={seg.key}
              cx={cx}
              cy={cx}
              r={r}
              stroke={seg.color}
              strokeWidth={stroke}
              strokeDasharray={dash}
              strokeDashoffset={dashOffset}
              strokeLinecap="butt"
              fill="none"
            />
          );
        })}
      </Svg>
      <Text style={bsStyles.ringCalories}>{cal}</Text>
      <Text style={bsStyles.ringUnit}>cal</Text>
    </View>
  );
}

function AddFoodModal({ visible, meal, onClose, onAddFood, onQuickAdd, customFoods, onCreateFood, onEditFood, onDeleteFood, onOpenLabel, onOpenMealScan, onOpenBarcode }) {
  const C = useContext(ThemeContext);
  const afStyles = mkAfStyles(C);
  const ssStyles = mkSsStyles(C);
  const [query,        setQuery]       = useState('');
  const [afTab,        setAfTab]       = useState('All');
  const [selectedRestaurant, setSelectedRestaurant] = useState(null);
  const [showCreate,   setShowCreate]  = useState(false);
  const [newFood,      setNewFood]     = useState(EMPTY_FOOD);
  const [editingFoodId, setEditingFoodId] = useState(null);
  const [apiResults,    setApiResults]   = useState([]);
  const [apiSearching,  setApiSearching]  = useState(false);
  const [usdaResults,    setUsdaResults]   = useState([]);
  const [usdaSearching,  setUsdaSearching]  = useState(false);
  const [saudiResults,   setSaudiResults]  = useState([]);
  const [saudiSearching, setSaudiSearching] = useState(false);
  const [supabaseResults, setSupabaseResults] = useState([]);
  const [supabaseSearching, setSupabaseSearching] = useState(false);
  const [recentFoods,    setRecentFoods]   = useState([]);
  const searchSettledRef = useRef(false);
  const [sortAZ,         setSortAZ]        = useState(false);
  const [servingFood,    setServingFood]    = useState(null);
  const [servings,       setServings]       = useState('1');
  const [unitMult,       setUnitMult]       = useState(1);
  const [unitLabel,      setUnitLabel]      = useState('');
  const [showUnitPicker, setShowUnitPicker] = useState(false);
  const [mealOverride,   setMealOverride]   = useState(null);
  const [showMealPicker,       setShowMealPicker]       = useState(false);
  const [showHeaderMealPicker, setShowHeaderMealPicker] = useState(false);
  const searchTimeout  = useRef(null);
  const servingsRef    = useRef(null);
  const afScrollRef    = useRef(null);
  const afScreenW      = Dimensions.get('window').width;
  const slideAnim      = useRef(new Animated.Value(afScreenW)).current;
  const detailSlide    = useRef(new Animated.Value(afScreenW)).current;
  const servingFoodRef = useRef(null);
  const [quickToastMsg, setQuickToastMsg] = useState('');
  const quickToastOpacity = useRef(new Animated.Value(0)).current;
  const quickToastY = useRef(new Animated.Value(8)).current;
  const quickToastTimer = useRef(null);

  const showQuickToast = (msg) => {
    clearTimeout(quickToastTimer.current);
    setQuickToastMsg(msg);
    quickToastOpacity.setValue(0);
    quickToastY.setValue(8);
    Animated.parallel([
      Animated.timing(quickToastOpacity, { toValue: 1, duration: 140, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(quickToastY, { toValue: 0, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    quickToastTimer.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(quickToastOpacity, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(quickToastY, { toValue: 8, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ]).start();
    }, 2000);
  };

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(afScreenW);
      Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 12, useNativeDriver: true }).start();
    } else {
      slideAnim.stopAnimation();
    }
  }, [visible]);

  useEffect(() => () => clearTimeout(quickToastTimer.current), []);

  const animatedClose = () => {
    Animated.timing(slideAnim, { toValue: afScreenW, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => onClose());
  };

  const openDetail = (food) => {
    servingFoodRef.current = food;
    setServingFood(food);
    setServings('1'); setUnitMult(1); setUnitLabel(''); setShowUnitPicker(false); setShowMealPicker(false); setShowHeaderMealPicker(false);
    detailSlide.setValue(afScreenW);
    Animated.spring(detailSlide, { toValue: 0, tension: 80, friction: 12, useNativeDriver: true }).start();
  };

  const closeDetailAnim = () => {
    Animated.timing(detailSlide, { toValue: afScreenW, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true })
      .start(() => { servingFoodRef.current = null; setServingFood(null); setServings('1'); setUnitMult(1); setUnitLabel(''); setShowUnitPicker(false); setMealOverride(null); });
  };

  const handleAfTabPress = (t) => {
    const idx = AF_TABS.indexOf(t);
    setAfTab(t);
    afScrollRef.current?.scrollTo({ x: idx * afScreenW, animated: true });
  };

  const handleAfScrollEnd = (e) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / afScreenW);
    setAfTab(AF_TABS[idx]);
  };
  const insets = useSafeAreaInsets();

  useEffect(() => {
    getJson(RECENTS_KEY, []).then(setRecentFoods);
  }, []);

  useEffect(() => {
    if (visible) {
      getJson(RECENTS_KEY, []).then(setRecentFoods);
    } else {
      setServingFood(null); setServings('1'); setUnitMult(1); setUnitLabel('');
      setShowUnitPicker(false); setMealOverride(null); setShowMealPicker(false);
      setQuery(''); setApiResults([]); setUsdaResults([]); setSaudiResults([]); setSupabaseResults([]);
      setSelectedRestaurant(null);
    }
  }, [visible]);

  const saveToRecents = (food) => {
    setRecentFoods(prev => {
      const deduped = [food, ...prev.filter(f => f.name !== food.name)].slice(0, 25);
      AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(deduped));
      return deduped;
    });
  };

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const q = query.trim();
    searchSettledRef.current = false;
    if (!q) {
      setApiResults([]); setUsdaResults([]); setSaudiResults([]); setSupabaseResults([]);
      setApiSearching(false); setUsdaSearching(false); setSaudiSearching(false); setSupabaseSearching(false);
      return () => { active = false; controller.abort(); clearTimeout(searchTimeout.current); };
    }
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      if (!active) return;

	      const searchQueries = expandedFoodQueries(q);
	      const isArabic   = /[؀-ۿ]/.test(q);
      const OFF_FIELDS = 'code,product_name,product_name_en,product_name_ar,brands,serving_size,nutriments,countries_tags';
      const OFF_HDR    = { 'User-Agent': 'Barbellz/1.0 (fitness app)' };
      const calExist   = encodeURIComponent('nutriments.energy-kcal_100g:>0');

      const parseOFF = (p, prefix) => {
        const n    = p.nutriments || {};
        const kcal = n['energy-kcal_100g'] ?? n['energy-kcal'] ?? (n['energy_100g'] ? n['energy_100g'] / 4.184 : 0);
        const name = isArabic
          ? (p.product_name_ar || p.product_name_en || p.product_name || '').trim()
          : (p.product_name_en || p.product_name_ar || p.product_name || '').trim();
        return {
          id:     `${prefix}_${p.code || Math.random()}`,
          name,
          brand:   Array.isArray(p.brands) ? (p.brands[0] || '') : (p.brands || ''),
          serving: p.serving_size || '100g',
          cal:    Math.round(kcal),
          p:      Math.round(n.proteins_100g         ?? n.proteins      ?? 0),
          c:      Math.round(n.carbohydrates_100g    ?? n.carbohydrates ?? 0),
          f:      Math.round(n.fat_100g              ?? n.fat           ?? 0),
          fiber:  Math.round(n.fiber_100g            ?? n['fiber-product_100g'] ?? 0),
          sugar:  Math.round(n.sugars_100g           ?? n.sugars        ?? 0),
          satFat: Math.round(n['saturated-fat_100g'] ?? n['saturated-fat']     ?? 0),
          sodium: Math.round((n.sodium_100g          ?? n.sodium        ?? 0) * 1000),
          source: prefix,
          countries: Array.isArray(p.countries_tags) ? p.countries_tags.join(' ') : '',
        };
      };

      const getNutrient = (nutrients, ...ids) => {
        for (const id of ids) {
          const fn = nutrients.find(n => n.nutrientId === id);
          if (fn?.value) return Math.round(fn.value);
        }
        return 0;
      };

      // Fire all sources simultaneously — each streams results as it resolves
      setSupabaseSearching(true); setSaudiSearching(true); setApiSearching(true); setUsdaSearching(true);

	      const p1 = Promise.allSettled(searchQueries.map(term => searchSupabaseFoods(term)))
	        .then(results => { if (active) { setSupabaseResults(results.flatMap(r => r.status === 'fulfilled' ? r.value : []).filter(f => f.name && Number(f.cal) > 0));  setSupabaseSearching(false); } })
	        .catch(() => { if (active) { setSupabaseResults([]); setSupabaseSearching(false); } });

      // Regional Open Food Facts: Saudi + GCC first, then UK and major Europe.
      const regionalHosts = [
        ['sa', 'saudi'],
        ['ae', 'uae'],
        ['kw', 'kuwait'],
        ['qa', 'qatar'],
        ['bh', 'bahrain'],
        ['om', 'oman'],
        ['uk', 'uk'],
        ['us', 'usa'],
        ['fr', 'france'],
        ['de', 'germany'],
        ['it', 'italy'],
        ['es', 'spain'],
        ['nl', 'netherlands'],
        ['be', 'belgium'],
        ['ch', 'switzerland'],
        ['pl', 'poland'],
      ];
	      const p2 = Promise.allSettled(regionalHosts.flatMap(([host, prefix]) =>
	        searchQueries.map(term =>
	          fetch(`https://${host}.openfoodfacts.org/api/v2/search?search_terms=${encodeURIComponent(term)}&fields=${OFF_FIELDS}&page_size=12`, { headers: OFF_HDR, signal: controller.signal })
	            .then(r => r.json())
	            .then(j => (j.products || []).map(p => parseOFF(p, prefix)).filter(f => f.name && f.cal > 0))
	        )
	      ))
        .then(results => {
          if (!active) return;
          setSaudiResults(results.flatMap(r => r.status === 'fulfilled' ? r.value : []));
          setSaudiSearching(false);
        })
        .catch(() => { if (active) { setSaudiResults([]);  setSaudiSearching(false); } });

      // search.openfoodfacts.org: global Elasticsearch — Saudi + GCC + UK + USA + World
      // No country filter = everything. No sort_by = Elasticsearch relevance score (best match first).
	      const p3 = Promise.allSettled(searchQueries.map(term =>
	        fetch(`https://search.openfoodfacts.org/search?q=${encodeURIComponent(term)}&fields=${encodeURIComponent(OFF_FIELDS)}&page_size=40&filter_query=${calExist}`, { headers: OFF_HDR, signal: controller.signal })
	          .then(r => r.json())
	          .then(j => (j.hits || []).map(p => parseOFF(p, 'off')).filter(f => f.name && f.cal > 0))
	      ))
	        .then(results => { if (active) { setApiResults(results.flatMap(r => r.status === 'fulfilled' ? r.value : []));  setApiSearching(false); } })
        .catch(() => { if (active) { setApiResults([]);  setApiSearching(false); } });

      const p4 = Promise.allSettled(searchQueries.map(term =>
        fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(term)}&api_key=${USDA_KEY}&pageSize=10&dataType=Branded,Foundation`, { signal: controller.signal })
          .then(r  => r.json())
          .then(j  => (j.foods || []).map((food, i) => {
            const fn = food.foodNutrients || [];
            const sz = food.servingSize ? `${Math.round(food.servingSize)}${(food.servingSizeUnit || 'g').toLowerCase()}` : '100g';
            return { id: `usda_${i}`, name: food.description || '', brand: food.brandOwner || food.brandName || '', serving: sz,
              cal: getNutrient(fn, 1008), p: getNutrient(fn, 1003), c: getNutrient(fn, 1005), f: getNutrient(fn, 1004),
              fiber: getNutrient(fn, 1079), sugar: getNutrient(fn, 2000, 1063), satFat: getNutrient(fn, 1258), sodium: getNutrient(fn, 1093) };
          }).filter(f => f.name && f.cal > 0))
      ))
        .then(results  => {
          if (active) { setUsdaResults(results.flatMap(r => r.status === 'fulfilled' ? r.value : [])); setUsdaSearching(false); }
        })
        .catch(() => { if (active) { setUsdaResults([]); setUsdaSearching(false); } });

      Promise.allSettled([p1, p2, p3, p4]).then(() => { if (active) searchSettledRef.current = true; });
    }, 600);
    return () => { active = false; controller.abort(); clearTimeout(searchTimeout.current); };
  }, [query]);

	  const allFoods = useMemo(() => [...FOOD_DB, ...customFoods], [customFoods]);
	  const results  = useMemo(() => {
	    const q = query.trim();
	    const terms = expandedFoodQueries(q);
	    if (q) return allFoods.filter(f => Number(f.cal) > 0 && terms.some(term => normalizeFoodSearch(`${f.name || ''} ${f.brand || ''}`).includes(term)));
	    if (sortAZ) return [...recentFoods].sort((a, b) => a.name.localeCompare(b.name));
	    return recentFoods;
	  }, [allFoods, query, recentFoods, sortAZ]);

  const handleAdd = (food) => {
    const targetMeal = mealOverride || meal;
    saveToRecents(food);
    (onQuickAdd || onAddFood)(targetMeal, {
      name: food.name, serving: food.serving, servings: 1,
      baseCal: food.cal, baseP: food.p, baseC: food.c, baseF: food.f,
      baseFiber: food.fiber || 0, baseSugar: food.sugar || 0, baseSatFat: food.satFat || 0, baseSodium: food.sodium || 0,
      baseServing: food.serving, unitMult: 1, unitLabel: food.serving,
      cal: food.cal, p: food.p, c: food.c, f: food.f,
      fiber: food.fiber || 0, sugar: food.sugar || 0, satFat: food.satFat || 0, sodium: food.sodium || 0,
    });
    if (onQuickAdd) showQuickToast(`Added to ${targetMeal}`);
  };

  const handleAddWithServings = () => {
    if (!servingFood) return;
    const sv         = Math.max(0.01, parseFloat(servings) || 1) * unitMult;
    const targetMeal = mealOverride || meal;
    saveToRecents(servingFood);
    onAddFood(targetMeal, {
      name: servingFood.name, serving: unitLabel || servingFood.serving, servings: parseFloat(servings) || 1,
      baseCal: servingFood.cal, baseP: servingFood.p, baseC: servingFood.c, baseF: servingFood.f,
      baseFiber: servingFood.fiber || 0, baseSugar: servingFood.sugar || 0, baseSatFat: servingFood.satFat || 0, baseSodium: servingFood.sodium || 0,
      baseServing: servingFood.serving, unitMult, unitLabel: unitLabel || servingFood.serving,
      cal:    Math.round(servingFood.cal          * sv),
      p:      Math.round(servingFood.p            * sv),
      c:      Math.round(servingFood.c            * sv),
      f:      Math.round(servingFood.f            * sv),
      fiber:  Math.round((servingFood.fiber  || 0) * sv),
      sugar:  Math.round((servingFood.sugar  || 0) * sv),
      satFat: Math.round((servingFood.satFat || 0) * sv),
      sodium: Math.round((servingFood.sodium || 0) * sv),
    });
    closeDetailAnim();
  };

  const goBack = () => {
    if (servingFood)             closeDetailAnim();
    else if (showCreate)         { setShowCreate(false); setEditingFoodId(null); setNewFood(EMPTY_FOOD); }
    else if (selectedRestaurant) setSelectedRestaurant(null);
    else                         animatedClose();
  };

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const closeDetailRef = useRef(null);
  closeDetailRef.current = closeDetailAnim;

  const detailPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => g.dx > 8 && g.dx > Math.abs(g.dy) * 1.2,
    onPanResponderGrant: () => detailSlide.stopAnimation(),
    onPanResponderMove: (_, g) => { if (g.dx > 0) detailSlide.setValue(g.dx); },
    onPanResponderRelease: (_, g) => {
      if (g.dx > afScreenW * 0.3 || g.vx > 0.4) {
        closeDetailRef.current();
      } else {
        Animated.spring(detailSlide, { toValue: 0, tension: 120, friction: 18, useNativeDriver: true }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.spring(detailSlide, { toValue: 0, tension: 120, friction: 18, useNativeDriver: true }).start();
    },
  })).current;

  const edgeResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder:  (_, g) => g.dx > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderGrant: () => {
        if (servingFoodRef.current) detailSlide.stopAnimation();
        else slideAnim.stopAnimation();
      },
      onPanResponderMove: (_, g) => {
        if (g.dx > 0) {
          if (servingFoodRef.current) detailSlide.setValue(g.dx);
          else slideAnim.setValue(g.dx);
        }
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx > afScreenW * 0.3 || g.vx > 0.4) {
          if (servingFoodRef.current) {
            closeDetailRef.current();
          } else {
            const remaining = afScreenW - g.dx;
            const duration  = Math.max(100, Math.min(220, remaining / Math.max(g.vx, 0.8) * 10));
            Animated.timing(slideAnim, { toValue: afScreenW, duration, easing: Easing.out(Easing.quad), useNativeDriver: true })
              .start(() => onCloseRef.current());
          }
        } else {
          if (servingFoodRef.current) Animated.spring(detailSlide, { toValue: 0, tension: 120, friction: 18, useNativeDriver: true }).start();
          else Animated.spring(slideAnim, { toValue: 0, tension: 120, friction: 18, useNativeDriver: true }).start();
        }
      },
      onPanResponderTerminate: () => {
        if (servingFoodRef.current) Animated.spring(detailSlide, { toValue: 0, tension: 120, friction: 18, useNativeDriver: true }).start();
        else Animated.spring(slideAnim, { toValue: 0, tension: 120, friction: 18, useNativeDriver: true }).start();
      },
    })
  ).current;

  const handleSaveCustom = () => {
    if (!newFood.name.trim() || !newFood.cal) return;
    const food = {
      id: editingFoodId ?? Date.now(),
      name:    newFood.name.trim(),
      brand:   newFood.brand.trim() || 'Custom',
      serving: newFood.serving.trim() || '100g',
      cal: Number(newFood.cal),
      p:   Number(newFood.p) || 0,
      c:   Number(newFood.c) || 0,
      f:   Number(newFood.f) || 0,
      fiber:  Number(newFood.fiber)  || 0,
      sugar:  Number(newFood.sugar)  || 0,
      satFat: Number(newFood.satFat) || 0,
      sodium: Number(newFood.sodium) || 0,
    };
    if (editingFoodId) {
      onEditFood(food);
    } else {
      onCreateFood(food);
      openDetail(food);
    }
    setNewFood(EMPTY_FOOD);
    setEditingFoodId(null);
    setShowCreate(false);
  };

  const field = (label, key, kb = 'default') => (
    <View style={afStyles.createField}>
      <Text style={afStyles.createLabel}>{label}</Text>
      <TextInput
        style={afStyles.createInput}
        value={newFood[key]}
        onChangeText={v => setNewFood(p => ({ ...p, [key]: v }))}
        placeholderTextColor={C.t3}
        placeholder={key === 'name' ? 'Required' : key === 'brand' ? 'Optional' : key === 'serving' ? '100g' : '0'}
        keyboardType={kb}
      />
    </View>
  );

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={animatedClose}>
      <Animated.View pointerEvents="none" style={[
        StyleSheet.absoluteFillObject,
        { backgroundColor: '#000', opacity: slideAnim.interpolate({ inputRange: [0, afScreenW], outputRange: [0.35, 0] }) }
      ]} />
      <Animated.View style={[afStyles.screen, { paddingTop: insets.top, transform: [{ translateX: slideAnim }],
        shadowColor: '#000', shadowOffset: { width: -4, height: 0 }, shadowOpacity: 0.18, shadowRadius: 10,
      }]}>
        <StatusBar barStyle={C.statusBar} />

        {/* Header */}
        <View style={afStyles.header}>
          <TouchableOpacity onPress={goBack} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={C.t1} />
          </TouchableOpacity>
          <TouchableOpacity style={afStyles.mealPicker}
            onPress={() => { if (!servingFood && !showCreate) setShowHeaderMealPicker(v => !v); }}
            activeOpacity={!servingFood && !showCreate ? 0.7 : 1}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={afStyles.mealName}>
                {servingFood ? 'Add Food' : showCreate ? (editingFoodId ? 'Edit Food' : 'Create Food') : (mealOverride || meal)}
              </Text>
              {!showCreate && !servingFood && <Ionicons name={showHeaderMealPicker ? 'chevron-up' : 'chevron-down'} size={14} color={C.accent} />}
            </View>
          </TouchableOpacity>
          {showCreate
            ? <TouchableOpacity onPress={handleSaveCustom} hitSlop={8}>
                <Text style={[afStyles.back, { fontSize: 15, color: C.accent, width: 40, textAlign: 'right' }]}>Save</Text>
              </TouchableOpacity>
            : servingFood
              ? <TouchableOpacity onPress={handleAddWithServings} hitSlop={8}>
                  <Text style={{ fontSize: 15, color: C.accent, fontWeight: '600', width: 40, textAlign: 'right' }}>Log</Text>
                </TouchableOpacity>
              : <View style={{ width: 40 }} />
          }
        </View>

        {/* ── CONTENT AREA — flex:1 so absolute overlays don't cover the header ── */}
        <View style={{ flex: 1, backgroundColor: C.bg }}>
        {/* Search/tabs — always mounted, hidden via display:none so scroll position survives */}
        <View style={{ flex: 1, display: (servingFood || showCreate) ? 'none' : 'flex' }}>
          <View style={afStyles.searchWrap}>
            <Ionicons name="search" size={15} color={C.t3} />
            <TextInput
              style={afStyles.searchInput}
              placeholder="Search foods, brands, flavors..."
              placeholderTextColor={C.t3}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={afStyles.tabsScroll} contentContainerStyle={afStyles.tabsContent}>
            {AF_TABS.map(t => (
              <TouchableOpacity key={t} onPress={() => handleAfTabPress(t)} style={afStyles.filterTab}>
                <Text style={[afStyles.filterTabText, afTab === t && afStyles.filterTabActive]}>{t}</Text>
                {afTab === t && <View style={afStyles.filterUnderline} />}
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={afStyles.sep} />

          <ScrollView
            ref={afScrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleAfScrollEnd}
            style={{ flex: 1 }}
          >
            {/* ── ALL ── */}
            <ScrollView style={{ width: afScreenW }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 12, paddingBottom: 100 }}>
              <View style={afStyles.actionRow}>
                {AF_ACTIONS.map(a => (
                  <TouchableOpacity
                    key={a.label}
                    style={afStyles.actionTile}
                    activeOpacity={0.75}
                    onPress={() => {
                      if (a.key === 'barcode') { onOpenBarcode(); }
                      if (a.key === 'meal')    { onOpenMealScan(); }
                      if (a.key === 'create')  { setNewFood(EMPTY_FOOD); setShowCreate(true); }
                    }}
                  >
                    <Ionicons name={a.icon} size={22} color={C.accent} />
                    <Text style={afStyles.actionLabel}>{a.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={afStyles.historyHeader}>
                <Text style={afStyles.historyTitle}>{query.trim() ? 'Results' : 'History'}</Text>
                {!query.trim() && (
                  <TouchableOpacity style={afStyles.sortBtn} onPress={() => setSortAZ(v => !v)}>
                    <Ionicons name="funnel-outline" size={11} color={C.t1} />
                    <Text style={afStyles.sortText}>{sortAZ ? 'A–Z' : 'Most Recent'}</Text>
                  </TouchableOpacity>
                )}
                {query.trim().length > 0 && (apiSearching || usdaSearching || saudiSearching || supabaseSearching) && (
                  <Text style={{ fontSize: 12, color: C.t3 }}>Searching…</Text>
                )}
              </View>

              <TouchableOpacity style={afStyles.foodCard} activeOpacity={0.8} onPress={() => { setNewFood(EMPTY_FOOD); setShowCreate(true); }}>
                <View style={{ flex: 1 }}>
                  <Text style={[afStyles.foodName, { color: C.accent }]}>+ Create a Food</Text>
                  <Text style={afStyles.foodSub}>Add your own custom food</Text>
                </View>
              </TouchableOpacity>

	              {(() => {
	                const q = query.trim();
	                const normalizedQuery = normalizeFoodSearch(q);
	                const queryTerms = expandedFoodQueries(q);
	                const hasCalories = food => Number(food.cal) > 0;
	                const matchesQuery = food => {
	                  const haystack = normalizeFoodSearch(`${food.name || ''} ${food.brand || ''}`);
	                  return queryTerms.some(term => haystack.includes(term));
	                };
	                const resultScore = (food) => {
	                  const name = normalizeFoodSearch(food.name);
	                  const brand = normalizeFoodSearch(food.brand);
	                  const combined = `${name} ${brand}`;
	                  const source = normalizeFoodSearch(food.source || '');
	                  const countries = normalizeFoodSearch(food.countries || '');
	                  const gccSource = ['saudi', 'uae', 'kuwait', 'qatar', 'bahrain', 'oman'].includes(source) || /saudi arabia|united arab emirates|kuwait|qatar|bahrain|oman/.test(countries);
	                  const regionalSource = gccSource || ['uk', 'usa', 'france', 'germany', 'italy', 'spain', 'netherlands', 'belgium', 'switzerland', 'poland'].includes(source);
	                  const macroDepth = [food.p, food.c, food.f].filter(v => Number(v) > 0).length;
	                  let score = 60;
	                  if (queryTerms.some(term => brand === term || name === term)) score = 0;
	                  else if (queryTerms.some(term => brand.startsWith(term) || name.startsWith(term))) score = 10;
	                  else if (queryTerms.some(term => combined.includes(term))) score = 20;
	                  if (gccSource) score -= 6;
	                  else if (regionalSource) score -= 2;
	                  score -= macroDepth;
	                  return score;
	                };
	                const restResults = normalizedQuery ? RESTAURANT_ITEMS_FLAT.filter(f => matchesQuery(f) && hasCalories(f)) : [];
	                const seen = new Set();
	                const dedup = (arr) => arr
	                  .filter(f => !normalizedQuery || hasCalories(f))
	                  .filter(f => { const k = `${normalizeFoodSearch(f.name)}::${normalizeFoodSearch(f.brand)}`; return seen.has(k) ? false : (seen.add(k), true); });
	                const allResults = [...dedup(results), ...dedup(supabaseResults), ...dedup(saudiResults), ...dedup(restResults), ...dedup(apiResults), ...dedup(usdaResults)]
	                  .sort((a, b) => resultScore(a) - resultScore(b));
	                const isSearching = apiSearching || usdaSearching || saudiSearching || supabaseSearching;
	                if (normalizedQuery.length > 0 && allResults.length === 0 && !isSearching && searchSettledRef.current) {
	                  return <Text style={afStyles.empty}>No verified open-data foods found. Try barcode scan or create this food.</Text>;
	                }
                return allResults.map((food, ri) => (
                  <TouchableOpacity key={`${food.id}_${ri}`} style={afStyles.foodCard} activeOpacity={0.8} onPress={() => openDetail(food)}>
                    <View style={{ flex: 1 }}>
                      <Text style={afStyles.foodName}>{food.name}</Text>
                      <Text style={afStyles.foodSub}>{food.cal} cal{food.serving ? `, ${food.serving}` : ''}{food.brand ? `, ${food.brand}` : ''}</Text>
                    </View>
                    <TouchableOpacity hitSlop={8} onPress={(e) => { e.stopPropagation(); handleAdd(food); }}>
                      <Ionicons name="add-circle" size={30} color={C.accent} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ));
              })()}
            </ScrollView>

            {/* ── RESTAURANTS ── */}
            <View style={{ width: afScreenW, flex: 1 }}>
              {selectedRestaurant ? (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 12, paddingBottom: 100 }}>
                  <TouchableOpacity style={afStyles.restBackRow} onPress={() => setSelectedRestaurant(null)}>
                    <Ionicons name="chevron-back" size={18} color={C.accent} />
                    <Text style={afStyles.restBackText}>All Restaurants</Text>
                  </TouchableOpacity>
                  <Text style={afStyles.restMenuTitle}>{selectedRestaurant.name}</Text>
                  {selectedRestaurant.items.map(food => (
                    <TouchableOpacity key={food.id} style={afStyles.foodCard} activeOpacity={0.8} onPress={() => openDetail({ ...food, brand: selectedRestaurant.name })}>
                      <View style={{ flex: 1 }}>
                        <Text style={afStyles.foodName}>{food.name}</Text>
                        <Text style={afStyles.foodSub}>{food.cal} cal, {food.serving}</Text>
                      </View>
                      <TouchableOpacity hitSlop={8} onPress={(e) => { e.stopPropagation(); handleAdd({ ...food, brand: selectedRestaurant.name }); }}>
                        <Ionicons name="add-circle" size={30} color={C.accent} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              ) : (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 12, paddingBottom: 100 }}>
                  {['Fast Food', 'Saudi Local', 'Coffee & Desserts', 'Healthy'].map(cat => (
                    <View key={cat}>
                      <Text style={afStyles.restCatLabel}>{cat}</Text>
                      {RESTAURANTS_DB.filter(r => r.category === cat).map(r => (
                        <TouchableOpacity key={r.id} style={afStyles.restRow} activeOpacity={0.75} onPress={() => setSelectedRestaurant(r)}>
                          <View style={afStyles.restIcon}>
                            <Ionicons name="storefront-outline" size={20} color={C.accent} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={afStyles.restName}>{r.name}</Text>
                            <Text style={afStyles.restCount}>{r.items.length} items</Text>
                          </View>
                          <Ionicons name="chevron-forward" size={16} color={C.t3} />
                        </TouchableOpacity>
                      ))}
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>

            {/* ── MY FOODS ── */}
            <ScrollView style={{ width: afScreenW }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 12, paddingBottom: 100 }}>
              <TouchableOpacity style={afStyles.foodCard} activeOpacity={0.8} onPress={() => { setNewFood(EMPTY_FOOD); setShowCreate(true); }}>
                <View style={{ flex: 1 }}>
                  <Text style={[afStyles.foodName, { color: C.accent }]}>+ Create a Food</Text>
                  <Text style={afStyles.foodSub}>Add your own custom food</Text>
                </View>
              </TouchableOpacity>
              {customFoods.length === 0
                ? <Text style={afStyles.empty}>No custom foods yet</Text>
                : customFoods.map(food => (
                  <TouchableOpacity key={food.id} style={afStyles.foodCard} activeOpacity={0.8} onPress={() => openDetail(food)}>
                    <View style={{ flex: 1 }}>
                      <Text style={afStyles.foodName}>{food.name}</Text>
                      <Text style={afStyles.foodSub}>{food.cal} cal, {food.serving}</Text>
                    </View>
                    <TouchableOpacity hitSlop={8} onPress={(e) => { e.stopPropagation(); handleAdd(food); }}>
                      <Ionicons name="add-circle" size={30} color={C.accent} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))
              }
            </ScrollView>
          </ScrollView>
        </View>{/* end search/tabs view */}

        {/* ── MFP-STYLE FOOD DETAIL — flex:1, slides in/out ── */}
        {servingFood && (
        <Animated.View
          style={{ flex: 1, backgroundColor: C.bg, transform: [{ translateX: detailSlide }] }}
          {...detailPan.panHandlers}
        >
            <ScrollView contentContainerStyle={{ paddingBottom: 100 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">

              {/* Food name + brand */}
              <View style={{ paddingHorizontal: 16, paddingTop: 22, paddingBottom: 18 }}>
                <Text style={{ fontSize: 24, fontWeight: '800', color: C.t1, letterSpacing: -0.5 }}>{servingFood.name}</Text>
                {!!servingFood.brand && (
                  <Text style={{ fontSize: 13, color: C.t3, marginTop: 5 }}>{servingFood.brand}</Text>
                )}
              </View>

              {/* Rows card */}
              <View style={{ backgroundColor: C.surface, marginHorizontal: 16, borderRadius: 14 }}>

                {/* Serving Size */}
                <View style={{ zIndex: 20 }}>
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 15 }}
                    onPress={() => { setShowUnitPicker(v => !v); setShowMealPicker(false); }}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontSize: 15, color: C.t2 }}>Serving Size</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: C.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
                      <Text style={{ fontSize: 14, color: C.t1, fontWeight: '600' }}>{unitLabel || servingFood.serving || '1 serving'}</Text>
                      <Ionicons name={showUnitPicker ? 'chevron-up' : 'chevron-down'} size={12} color={C.accent} />
                    </View>
                  </TouchableOpacity>
                  {showUnitPicker && (() => {
                    const base = servingFood.serving || '1 serving';
                    const options = servingOptionsFor(base);
                    const activeLabel = unitLabel || String(base).replace(/\s+/g, ' ').trim();
                    return (
                      <View style={ssStyles.dropdown}>
                        <ScrollView bounces={false} showsVerticalScrollIndicator indicatorStyle="white" scrollIndicatorInsets={{ top: 6, bottom: 6, right: 2 }} keyboardShouldPersistTaps="handled">
                          {options.map((opt, idx) => (
                            <TouchableOpacity
                              key={opt.label}
                              style={[ssStyles.dropdownRow, idx > 0 && ssStyles.dropdownDivider]}
                              activeOpacity={0.75}
                              onPress={() => { setUnitMult(opt.mult); setUnitLabel(opt.label); setShowUnitPicker(false); }}
                            >
                              <Text style={ssStyles.dropdownText}>{opt.label}</Text>
                              {activeLabel === opt.label && <Ionicons name="checkmark-circle" size={18} color={C.accent} />}
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    );
                  })()}
                </View>
                <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 16 }} />

                {/* Number of Servings */}
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13 }}
                  onPress={() => servingsRef.current?.focus()}
                  activeOpacity={0.7}
                >
                  <Text style={{ fontSize: 15, color: C.t2 }}>Number of Servings</Text>
                  <View style={{ borderWidth: 1.5, borderColor: C.s3, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6, minWidth: 72, alignItems: 'center' }}>
                    <TextInput
                      ref={servingsRef}
                      style={{ fontSize: 15, color: C.accent, fontWeight: '700', textAlign: 'center', padding: 0 }}
                      value={servings}
                      onChangeText={setServings}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                    />
                  </View>
                </TouchableOpacity>
                <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 16 }} />

                {/* Meal */}
                <View style={{ zIndex: 15 }}>
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 15 }}
                    onPress={() => { setShowMealPicker(v => !v); setShowUnitPicker(false); }}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontSize: 15, color: C.t2 }}>Meal</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: C.s3, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
                      <Text style={{ fontSize: 14, color: C.accent, fontWeight: '700' }}>{mealOverride || meal}</Text>
                      <Ionicons name={showMealPicker ? 'chevron-up' : 'chevron-down'} size={12} color={C.accent} />
                    </View>
                  </TouchableOpacity>
                  {showMealPicker && (
                    <View style={[ssStyles.dropdown, { minWidth: 160 }]}>
                      {['Breakfast', 'Lunch', 'Dinner', 'Snacks'].map((m, idx) => {
                        const active = (mealOverride || meal) === m;
                        return (
                          <TouchableOpacity
                            key={m}
                            style={[ssStyles.dropdownRow, idx > 0 && ssStyles.dropdownDivider]}
                            activeOpacity={0.75}
                            onPress={() => { setMealOverride(m); setShowMealPicker(false); }}
                          >
                            <Text style={ssStyles.dropdownText}>{m}</Text>
                            {active && <Ionicons name="checkmark-circle" size={18} color={C.accent} />}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              </View>

              {/* Calorie ring + macro % */}
              {(() => {
                const sv  = Math.max(0.01, parseFloat(servings) || 1) * unitMult;
                const cal = Math.round(servingFood.cal * sv);
                const p   = Math.round(servingFood.p   * sv);
                const c   = Math.round(servingFood.c   * sv);
                const f   = Math.round(servingFood.f   * sv);
                const totalMacroCal = c * 4 + f * 9 + p * 4 || 1;
                const carbPct = Math.round((c * 4 / totalMacroCal) * 100);
                const fatPct  = Math.round((f * 9 / totalMacroCal) * 100);
                const protPct = 100 - carbPct - fatPct;
                const S = 90;
                return (
                  <View style={{ backgroundColor: C.surface, marginHorizontal: 16, marginTop: 12, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 22, gap: 20 }}>
                    {/* Ring */}
                    <View style={{ width: S, height: S, alignItems: 'center', justifyContent: 'center' }}>
                      <MacroCaloriesRing cal={cal} p={p} c={c} f={f} size={S} />
                      <View style={{ position: 'absolute', alignItems: 'center' }}>
                        <Text style={{ fontSize: 18, fontWeight: '800', color: C.t1, lineHeight: 22 }}>{cal}</Text>
                        <Text style={{ fontSize: 10, color: C.t3, letterSpacing: 0.3 }}>cal</Text>
                      </View>
                    </View>
                    {/* Macro columns */}
                    <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-around' }}>
                      {[
                        { pct: carbPct, grams: c, label: 'Carbs',   color: '#30D158' },
                        { pct: fatPct,  grams: f, label: 'Fat',     color: '#BF5AF2' },
                        { pct: protPct, grams: p, label: 'Protein', color: '#FFB340' },
                      ].map(m => (
                        <View key={m.label} style={{ alignItems: 'center', gap: 2 }}>
                          <Text style={{ fontSize: 12, color: m.color, fontWeight: '700' }}>{m.pct}%</Text>
                          <Text style={{ fontSize: 20, fontWeight: '800', color: C.t1 }}>{m.grams}</Text>
                          <Text style={{ fontSize: 10, color: C.t3 }}>g {m.label}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })()}
              {/* Edit / Delete — only for custom foods */}
              {customFoods.some(f => f.id === servingFood?.id) && (
                <View style={{ marginHorizontal: 16, marginTop: 20, gap: 10 }}>
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.s2, borderRadius: 14, paddingVertical: 14 }}
                    activeOpacity={0.75}
                    onPress={() => { setEditingFoodId(servingFood.id); setNewFood({ name: servingFood.name, brand: servingFood.brand || '', serving: servingFood.serving || '100g', cal: String(servingFood.cal), p: String(servingFood.p), c: String(servingFood.c), f: String(servingFood.f), fiber: String(servingFood.fiber || 0), sugar: String(servingFood.sugar || 0), satFat: String(servingFood.satFat || 0), sodium: String(servingFood.sodium || 0) }); closeDetailAnim(); setShowCreate(true); }}
                  >
                    <Ionicons name="pencil-outline" size={17} color={C.t1} />
                    <Text style={{ fontSize: 15, color: C.t1, fontWeight: '600' }}>Edit Food</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(255,55,95,0.12)', borderRadius: 14, paddingVertical: 14 }}
                    activeOpacity={0.75}
                    onPress={() => { onDeleteFood(servingFood.id); closeDetailAnim(); }}
                  >
                    <Ionicons name="trash-outline" size={17} color="#FF375F" />
                    <Text style={{ fontSize: 15, color: '#FF375F', fontWeight: '600' }}>Delete Food</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
        </Animated.View>
        )}

        {/* ── CREATE FOOD FORM ── */}
        {showCreate && (
          <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top + 48}>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
              {field('Food Name', 'name')}
              {field('Brand (optional)', 'brand')}
              {field('Serving Size', 'serving')}
              <View style={afStyles.createDivider} />
              {field('Calories', 'cal', 'numeric')}
              {field('Protein (g)', 'p', 'numeric')}
              {field('Carbs (g)', 'c', 'numeric')}
              {field('Fat (g)', 'f', 'numeric')}
              <View style={afStyles.createDivider} />
              {field('Fiber (g)', 'fiber', 'numeric')}
              {field('Sugar (g)', 'sugar', 'numeric')}
              {field('Saturated Fat (g)', 'satFat', 'numeric')}
              {field('Sodium (mg)', 'sodium', 'numeric')}
              <TouchableOpacity style={afStyles.saveBtn} onPress={handleSaveCustom} activeOpacity={0.8}>
                <Text style={afStyles.saveBtnText}>{editingFoodId ? 'Save Changes' : `Save & Add to ${mealOverride || meal}`}</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        )}
        </View>{/* end content area */}

        {showHeaderMealPicker && !servingFood && !showCreate && (
          <>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowHeaderMealPicker(false)} />
            <View style={{ position: 'absolute', top: insets.top + 48, alignSelf: 'center', width: 200, backgroundColor: C.s2, borderRadius: 14, zIndex: 150, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 12 }}>
              {['Breakfast', 'Lunch', 'Dinner', 'Snacks'].map((m, idx) => {
                const active = (mealOverride || meal) === m;
                return (
                  <TouchableOpacity
                    key={m}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: idx > 0 ? 0.5 : 0, borderTopColor: C.border }}
                    onPress={() => { setMealOverride(m); setShowHeaderMealPicker(false); }}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontSize: 15, color: active ? C.accent : C.t1, fontWeight: active ? '700' : '400' }}>{m}</Text>
                    {active && <Ionicons name="checkmark-circle" size={18} color={C.accent} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        <Animated.View pointerEvents="none" style={[afStyles.quickToast, { opacity: quickToastOpacity, transform: [{ translateY: quickToastY }] }]}>
          <Ionicons name="checkmark-circle" size={18} color="#30D158" />
          <Text style={afStyles.quickToastText}>{quickToastMsg}</Text>
        </Animated.View>

        {/* Keep the edge gesture narrow so it doesn't cover the first action tile. */}
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 28, zIndex: 200 }} {...edgeResponder.panHandlers} />
      </Animated.View>
    </Modal>
  );
}


// ── BARCODE SCANNER MODAL ─────────────────────────────────
const BS_HEADERS          = { 'User-Agent': 'Barbellz/1.0 (fitness app)' };
const BS_FIELDS           = 'product_name,product_name_en,product_name_ar,brands,serving_size,nutriments,countries_tags';
const BS_BARCODE_SETTINGS = { barcodeTypes: ['ean13','ean8','upc_a','upc_e','code128','qr'] };

async function bsFetchProduct(barcode) {
  const urls = [
    `https://world.openfoodfacts.org/api/v2/product/${barcode}?fields=${BS_FIELDS}`,
    `https://sa.openfoodfacts.org/api/v2/product/${barcode}?fields=${BS_FIELDS}`,
  ];
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res  = await fetch(url, { headers: BS_HEADERS, signal: controller.signal });
      clearTimeout(timer);
      const json = await res.json();
      if (json.status === 1 && json.product) return json.product;
    } catch {
      // try next URL
    }
  }
  return null;
}

function bsParseProduct(p) {
  const n = p.nutriments || {};
  const hasServing = n['energy-kcal_serving'] != null || n['proteins_serving'] != null;
  const sfx = hasServing ? '_serving' : '_100g';
  const serving = hasServing ? (p.serving_size || '1 serving') : '100g';
  const kcal = hasServing
    ? (n['energy-kcal_serving'] ?? (n['energy_serving'] ? n['energy_serving'] / 4.184 : 0))
    : (n['energy-kcal_100g']   ?? (n['energy_100g']    ? n['energy_100g']    / 4.184 : 0));
  const name = p.product_name_en || p.product_name || p.product_name_ar || 'Unknown Product';
  return {
    name, brand: p.brands || '', serving,
    cal:    Math.round(kcal),
    p:      Math.round(n[`proteins${sfx}`]                          ?? 0),
    c:      Math.round(n[`carbohydrates${sfx}`]                     ?? 0),
    f:      Math.round(n[`fat${sfx}`]                               ?? 0),
    fiber:  Math.round(n[`fiber${sfx}`] ?? n[`fiber-product${sfx}`] ?? 0),
    sugar:  Math.round(n[`sugars${sfx}`]                            ?? 0),
    satFat: Math.round(n[`saturated-fat${sfx}`]                     ?? 0),
    sodium: Math.round((n[`sodium${sfx}`] ?? 0) * 1000),
  };
}

function BarcodeScannerModal({ visible, meal, onClose, onAddFood, onScanLabel }) {
  const C = useContext(ThemeContext);
  const bsStyles = mkBsStyles(C);
  const ssStyles = mkSsStyles(C);
  const [permission, requestPermission] = useCameraPermissions();
  const [loading,      setLoading]      = useState(false);
  const [foundFood,    setFoundFood]    = useState(null);
  const [notFound,     setNotFound]     = useState(null);
  const [cameraReady,  setCameraReady]  = useState(false);
  const [detectedCode, setDetectedCode] = useState(null);
  const [servings,     setServings]     = useState('1');
  const [selectedMeal, setSelectedMeal] = useState(meal || 'Breakfast');
  const [showMealPicker, setShowMealPicker] = useState(false);
  const [unitMult,     setUnitMult]     = useState(1);
  const [unitLabel,    setUnitLabel]    = useState('');
  const [showUnitPicker, setShowUnitPicker] = useState(false);
  const processing = useRef(false);
  const insets = useSafeAreaInsets();

  const onCameraReady = useCallback(() => setCameraReady(true), []);
  const mealOptions = EMPTY_MEALS.map(m => m.name);
  const servingCount = Math.max(0.01, parseFloat(servings) || 1) * unitMult;
  const adjustedFood = foundFood ? {
    ...foundFood,
    cal:    Math.round((foundFood.cal    || 0) * servingCount),
    p:      Math.round((foundFood.p      || 0) * servingCount),
    c:      Math.round((foundFood.c      || 0) * servingCount),
    f:      Math.round((foundFood.f      || 0) * servingCount),
    fiber:  Math.round((foundFood.fiber  || 0) * servingCount),
    sugar:  Math.round((foundFood.sugar  || 0) * servingCount),
    satFat: Math.round((foundFood.satFat || 0) * servingCount),
    sodium: Math.round((foundFood.sodium || 0) * servingCount),
  } : null;
  const macroCals = adjustedFood ? Math.max(adjustedFood.p * 4 + adjustedFood.c * 4 + adjustedFood.f * 9, 1) : 1;
  const macroPct = adjustedFood ? {
    carbs: Math.round((adjustedFood.c * 4 / macroCals) * 100),
    fat: Math.round((adjustedFood.f * 9 / macroCals) * 100),
    protein: Math.round((adjustedFood.p * 4 / macroCals) * 100),
  } : { carbs: 0, fat: 0, protein: 0 };

  const addScannedFood = useCallback(() => {
    if (!adjustedFood) return;
    getJson(RECENTS_KEY, []).then(prev => {
      const deduped = [foundFood, ...prev.filter(f => f.name !== foundFood.name)].slice(0, 25);
      setJson(RECENTS_KEY, deduped);
    });
    onAddFood(selectedMeal, {
      name: adjustedFood.name,
      serving: unitLabel || adjustedFood.serving,
      servings: Math.max(0.01, parseFloat(servings) || 1),
      unitLabel: unitLabel || foundFood.serving,
      unitMult,
      baseServing: foundFood.serving,
      baseCal: foundFood.cal,
      baseP: foundFood.p,
      baseC: foundFood.c,
      baseF: foundFood.f,
      baseFiber: foundFood.fiber || 0,
      baseSugar: foundFood.sugar || 0,
      baseSatFat: foundFood.satFat || 0,
      baseSodium: foundFood.sodium || 0,
      cal: adjustedFood.cal,
      p: adjustedFood.p,
      c: adjustedFood.c,
      f: adjustedFood.f,
      fiber: adjustedFood.fiber || 0,
      sugar: adjustedFood.sugar || 0,
      satFat: adjustedFood.satFat || 0,
      sodium: adjustedFood.sodium || 0,
    });
  }, [adjustedFood, foundFood, onAddFood, selectedMeal, servingCount, servings, unitLabel, unitMult]);

  const handleBarcode = useCallback(async ({ data }) => {
    if (processing.current) return;
    processing.current = true;
    setDetectedCode(data);
    setLoading(true);
    try {
      const sharedFood = await getSupabaseFoodByBarcode(data);
      if (sharedFood) {
        setFoundFood(sharedFood);
      } else {
        const product = await bsFetchProduct(data);
        if (product) {
          setFoundFood(bsParseProduct(product));
        } else {
          setNotFound(data);
        }
      }
    } catch (e) {
      Alert.alert('Error', e?.message || 'Could not reach the food database. Check your connection.');
    }
    processing.current = false;
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!visible) {
      setFoundFood(null); setNotFound(null); setLoading(false); setCameraReady(false);
      setDetectedCode(null); setServings('1'); setSelectedMeal(meal || 'Breakfast');
      setShowMealPicker(false); setUnitMult(1); setUnitLabel(''); setShowUnitPicker(false);
      processing.current = false;
    }
  }, [visible, meal]);

  useEffect(() => {
    if (visible && meal) setSelectedMeal(meal);
  }, [visible, meal]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[bsStyles.screen, { paddingTop: insets.top }]}>
        <SwipeBackEdge onBack={foundFood ? () => setFoundFood(null) : onClose} />
        <StatusBar barStyle={C.statusBar} />
        <View style={bsStyles.header}>
          <TouchableOpacity onPress={foundFood ? () => setFoundFood(null) : onClose} hitSlop={12}>
            <Text style={bsStyles.cancel}>{foundFood ? 'Back' : 'Cancel'}</Text>
          </TouchableOpacity>
          <Text style={bsStyles.title}>{foundFood ? 'Add Food' : 'Scan Barcode'}</Text>
          {foundFood ? (
            <TouchableOpacity onPress={addScannedFood} hitSlop={12} style={bsStyles.headerIconBtn}>
              <Ionicons name="checkmark" size={30} color={C.t1} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 60 }} />
          )}
        </View>

        {(!permission || !permission.granted) ? (
          <View style={bsStyles.permWrap}>
            <Text style={bsStyles.permTitle}>Camera Access Needed</Text>
            <Text style={bsStyles.permSub}>Required to scan barcodes</Text>
            {permission?.canAskAgain !== false ? (
              <TouchableOpacity style={bsStyles.permBtn} onPress={requestPermission}>
                <Text style={bsStyles.permBtnText}>Allow Camera</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={bsStyles.permBtn} onPress={() => Linking.openSettings()}>
                <Text style={bsStyles.permBtnText}>Open Settings</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : foundFood ? (
          <View style={bsStyles.resultWrap}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
              <View style={bsStyles.matchBanner}>
                <Text style={bsStyles.matchText} numberOfLines={1}>This barcode was matched to: "{foundFood.name}"</Text>
                <TouchableOpacity onPress={() => { setFoundFood(null); setServings('1'); }}>
                  <Text style={bsStyles.matchLink}>Find a better match</Text>
                </TouchableOpacity>
              </View>

              <View style={bsStyles.reviewHeader}>
                <Text style={bsStyles.reviewName}>{foundFood.name}</Text>
                {!!foundFood.brand && <Text style={bsStyles.reviewBrand}>{foundFood.brand}</Text>}
              </View>

              <View style={bsStyles.formRows}>
                <View style={[bsStyles.formRow, { zIndex: 20 }]}>
                  <Text style={bsStyles.formLabel}>Serving Size</Text>
                  <View style={{ position: 'relative' }}>
                    <TouchableOpacity
                      style={bsStyles.formValueBox}
                      activeOpacity={0.75}
                      onPress={() => { setShowUnitPicker(v => !v); setShowMealPicker(false); }}
                    >
                      <Text style={bsStyles.formValue} numberOfLines={1}>{unitLabel || foundFood.serving || '1 serving'}</Text>
                      <Ionicons name={showUnitPicker ? 'chevron-up' : 'chevron-down'} size={13} color={C.accent} style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                    {showUnitPicker && (
                      <View style={ssStyles.dropdown}>
                        <ScrollView bounces={false} showsVerticalScrollIndicator indicatorStyle="white" scrollIndicatorInsets={{ top: 6, bottom: 6, right: 2 }} keyboardShouldPersistTaps="handled">
                          {servingOptionsFor(foundFood.serving || '1 serving').map((option, idx) => {
                            const active = (unitLabel || String(foundFood.serving || '1 serving').replace(/\s+/g, ' ').trim()) === option.label;
                            return (
                              <TouchableOpacity key={option.label} style={[ssStyles.dropdownRow, idx > 0 && ssStyles.dropdownDivider]} onPress={() => { setUnitLabel(option.label); setUnitMult(option.mult); setShowUnitPicker(false); }}>
                                <Text style={ssStyles.dropdownText}>{option.label}</Text>
                                {active && <Ionicons name="checkmark-circle" size={18} color={C.accent} />}
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </View>
                    )}
                  </View>
                </View>

                <View style={bsStyles.formRow}>
                  <Text style={bsStyles.formLabel}>Number of Servings</Text>
                  <TextInput
                    style={bsStyles.servingsInput}
                    value={servings}
                    onChangeText={setServings}
                    keyboardType="decimal-pad"
                    selectTextOnFocus
                  />
                </View>

                <View style={[bsStyles.formRow, { zIndex: 10 }]}>
                  <Text style={bsStyles.formLabel}>Meal</Text>
                  <View style={{ position: 'relative' }}>
                    <TouchableOpacity
                      style={bsStyles.formValueBox}
                      activeOpacity={0.75}
                      onPress={() => { setShowMealPicker(v => !v); setShowUnitPicker(false); }}
                    >
                      <Text style={bsStyles.formValue}>{selectedMeal}</Text>
                      <Ionicons name={showMealPicker ? 'chevron-up' : 'chevron-down'} size={13} color={C.accent} style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                    {showMealPicker && (
                      <View style={ssStyles.dropdown}>
                        <ScrollView bounces={false} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                          {mealOptions.map((option, idx) => (
                            <TouchableOpacity key={option} style={[ssStyles.dropdownRow, idx > 0 && ssStyles.dropdownDivider]} onPress={() => { setSelectedMeal(option); setShowMealPicker(false); }}>
                              <Text style={ssStyles.dropdownText}>{option}</Text>
                              {selectedMeal === option && <Ionicons name="checkmark-circle" size={18} color={C.accent} />}
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    )}
                  </View>
                </View>
              </View>

              <View style={bsStyles.nutritionSummary}>
                <MacroCaloriesRing cal={adjustedFood.cal} p={adjustedFood.p} c={adjustedFood.c} f={adjustedFood.f} />
                {[
                  { label: 'Carbs',   grams: adjustedFood.c, pct: macroPct.carbs,   color: '#30D158' },
                  { label: 'Fat',     grams: adjustedFood.f, pct: macroPct.fat,     color: '#BF5AF2' },
                  { label: 'Protein', grams: adjustedFood.p, pct: macroPct.protein, color: '#FFB340' },
                ].map(macro => (
                  <View key={macro.label} style={bsStyles.reviewMacro}>
                    <Text style={[bsStyles.reviewMacroPct, { color: macro.color }]}>{macro.pct}%</Text>
                    <Text style={bsStyles.reviewMacroVal}>{macro.grams} g</Text>
                    <Text style={bsStyles.reviewMacroLbl}>{macro.label}</Text>
                  </View>
                ))}
              </View>

              <TouchableOpacity style={bsStyles.addBtn} activeOpacity={0.85} onPress={addScannedFood}>
                <Text style={bsStyles.addBtnText}>Add to {selectedMeal}</Text>
              </TouchableOpacity>
              <View style={bsStyles.sponsorSpace} />
            </ScrollView>

          </View>
        ) : notFound ? (
          <View style={bsStyles.resultWrap}>
            <View style={bsStyles.foodCard}>
              <Text style={bsStyles.foodName}>Product Not Found</Text>
              <Text style={{ fontSize: 13, color: C.t3, marginTop: 4 }}>This product isn't in the database yet.</Text>
              <Text style={{ fontSize: 11, color: C.t3, marginTop: 8, fontFamily: 'Courier', letterSpacing: 1 }}>{notFound}</Text>
            </View>
            <TouchableOpacity style={bsStyles.addBtn} activeOpacity={0.8}
              onPress={() => { processing.current = false; setNotFound(null); onScanLabel(notFound); }}>
              <Text style={bsStyles.addBtnText}>Scan Nutrition Label Instead</Text>
            </TouchableOpacity>
            <TouchableOpacity style={bsStyles.scanAgain} onPress={() => { setNotFound(null); processing.current = false; }}>
              <Text style={bsStyles.scanAgainText}>Scan Again</Text>
            </TouchableOpacity>
          </View>
        ) : visible ? (
          <View style={{ flex: 1 }}>
            <CameraView
              style={bsStyles.camera}
              facing="back"
              onCameraReady={onCameraReady}
              onBarcodeScanned={handleBarcode}
              barcodeScannerSettings={BS_BARCODE_SETTINGS}
            />
            <View style={bsStyles.overlay} pointerEvents="none">
              <View style={[bsStyles.scanFrame, loading && { borderColor: '#fff' }]} />
              <Text style={bsStyles.hint}>
                {loading ? `Scanning ${detectedCode}…` : cameraReady ? 'Point at a barcode' : 'Starting camera…'}
              </Text>
              {loading && (
                <View style={{ marginTop: 16, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
                  <Text style={{ color: '#fff', fontSize: 12, opacity: 0.8 }}>This may take a few seconds</Text>
                </View>
              )}
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

// ── QUICK ADD MODAL ───────────────────────────────────────
// ── LABEL SCANNER MODAL ───────────────────────────────────
const AI_PROXY = 'https://barbellz-ai.z-alrubian.workers.dev';

function LabelScannerModal({ visible, meal, onClose, onAddFood, pendingBarcode }) {
  const C = useContext(ThemeContext);
  const bsStyles = mkBsStyles(C);
  const lsStyles = mkLsStyles(C);
  const [permission, requestPermission] = useCameraPermissions();
  const [, setPhoto] = useState(null);
  const [loading,           setLoading]           = useState(false);
  const [foundFood,         setFoundFood]         = useState(null);
  const [cameraReady,       setCameraReady]       = useState(false);
  const [showContribute,    setShowContribute]    = useState(false);
  const [contributeName,    setContributeName]    = useState('');
  const [contributeLoading, setContributeLoading] = useState(false);
  const [contributeSuccess, setContributeSuccess] = useState(false);
  const cameraRef = useRef(null);
  const insets    = useSafeAreaInsets();

  useEffect(() => {
    if (!visible) {
      setPhoto(null); setFoundFood(null); setLoading(false); setCameraReady(false);
      setShowContribute(false); setContributeName(''); setContributeLoading(false); setContributeSuccess(false);
    }
  }, [visible]);

  useEffect(() => {
    if (foundFood) setContributeName(foundFood.name !== 'Unknown' ? foundFood.name : '');
  }, [foundFood]);

  const submitToDatabase = async () => {
    if (!pendingBarcode) return;
    setContributeLoading(true);
    try {
      const params = new URLSearchParams({
        user_id: 'barbellz-app', password: '',
        code: pendingBarcode,
        product_name: contributeName.trim() || foundFood.name,
        'nutriment_energy-kcal': String(foundFood.cal),
        nutriment_proteins:       String(foundFood.p),
        nutriment_carbohydrates:  String(foundFood.c),
        nutriment_fat:            String(foundFood.f),
        countries_tags: 'en:saudi-arabia',
      });
      const res  = await fetch('https://world.openfoodfacts.org/cgi/product_jqm2.pl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Barbellz/1.0 (fitness app)' },
        body: params.toString(),
      });
      const json = await res.json();
      if (json.status === 1 || json.status_verbose?.includes('saved')) {
        setContributeSuccess(true);
      } else {
        Alert.alert('Submit failed', 'Could not save to the database. Try again later.');
      }
    } catch {
      Alert.alert('Submit failed', 'Check your connection and try again.');
    }
    setContributeLoading(false);
  };

  const takePhoto = async () => {
    if (!cameraRef.current || !cameraReady) return;
    try {
      const pic = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.4 });
      setPhoto(pic);
      await analyseLabel(pic.base64);
    } catch (e) {
      Alert.alert('Capture failed', e?.message || 'Could not take photo. Try again.');
    }
  };

  const analyseLabel = async (base64) => {
    setLoading(true);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(AI_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Read this nutrition label carefully. Find the "Per Serving" or "Per Portion" column (NOT per 100g). Read the serving size description AND the calories for that serving — they must match. Return ONLY valid JSON with no explanation: {"name":"product name or Unknown","serving":"exact serving size shown (e.g. 1 cup / 30g / 2 tablets)","cal":calories_per_serving,"p":protein_g,"c":total_carbs_g,"f":total_fat_g,"fiber":dietary_fiber_g,"sugar":sugars_g,"satFat":saturated_fat_g,"sodium":sodium_mg}. All values must be for ONE serving as defined on the label.' },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
            ],
          }],
          max_tokens: 250,
        }),
      });
      clearTimeout(timer);
      const json = await res.json();
      if (json.error) {
        Alert.alert('AI Error', json.error.message || JSON.stringify(json.error));
        setPhoto(null);
        setLoading(false);
        return;
      }
      const text = json.choices?.[0]?.message?.content || '';
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const food = JSON.parse(match[0]);
        food.cal    = Math.max(0, Math.min(Number(food.cal)    || 0, 5000));
        food.p      = Math.max(0, Math.min(Number(food.p)      || 0, 300));
        food.c      = Math.max(0, Math.min(Number(food.c)      || 0, 500));
        food.f      = Math.max(0, Math.min(Number(food.f)      || 0, 300));
        food.fiber  = Math.max(0, Math.min(Number(food.fiber)  || 0, 200));
        food.sugar  = Math.max(0, Math.min(Number(food.sugar)  || 0, 300));
        food.satFat = Math.max(0, Math.min(Number(food.satFat) || 0, 200));
        food.sodium = Math.max(0, Math.min(Number(food.sodium) || 0, 10000));
        if (pendingBarcode) food.barcode = pendingBarcode;
        setFoundFood(food);
      } else {
        Alert.alert('Could not read label', text || 'Try pointing at the nutrition facts table more directly.');
        setPhoto(null);
      }
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to analyse label. Check your connection.');
      setPhoto(null);
    }
    setLoading(false);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[lsStyles.screen, { paddingTop: insets.top }]}>
        <SwipeBackEdge onBack={onClose} />
        <StatusBar barStyle={C.statusBar} />
        <View style={lsStyles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={12}><Text style={lsStyles.cancel}>Cancel</Text></TouchableOpacity>
          <Text style={lsStyles.title}>Scan Nutrition Label</Text>
          <View style={{ width: 60 }} />
        </View>

        {(!permission || !permission.granted) ? (
          <View style={bsStyles.permWrap}>
            <Text style={bsStyles.permTitle}>Camera Access Needed</Text>
            <Text style={bsStyles.permSub}>Required to scan labels</Text>
            {permission?.canAskAgain !== false ? (
              <TouchableOpacity style={bsStyles.permBtn} onPress={requestPermission}>
                <Text style={bsStyles.permBtnText}>Allow Camera</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={bsStyles.permBtn} onPress={() => Linking.openSettings()}>
                <Text style={bsStyles.permBtnText}>Open Settings</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : foundFood ? (
          <KeyboardAvoidingView style={bsStyles.resultWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top + 48}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ paddingBottom: 44 }}>
              <View style={bsStyles.foodCard}>
                <Text style={bsStyles.foodName}>{foundFood.name}</Text>
                <Text style={bsStyles.foodServing}>Per {foundFood.serving}</Text>
                <View style={bsStyles.macroRow}>
                  {[
                    { label: 'Calories', val: foundFood.cal, unit: '' },
                    { label: 'Protein',  val: foundFood.p,   unit: 'g' },
                    { label: 'Carbs',    val: foundFood.c,   unit: 'g' },
                    { label: 'Fat',      val: foundFood.f,   unit: 'g' },
                  ].map(m => (
                    <View key={m.label} style={bsStyles.macroItem}>
                      <Text style={bsStyles.macroVal}>{m.val}{m.unit}</Text>
                      <Text style={bsStyles.macroLbl}>{m.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <TouchableOpacity style={bsStyles.addBtn} activeOpacity={0.8}
                onPress={() => {
                  getJson(RECENTS_KEY, []).then(prev => {
                    const deduped = [foundFood, ...prev.filter(f => f.name !== foundFood.name)].slice(0, 25);
                    setJson(RECENTS_KEY, deduped);
                  });
                  onAddFood(meal, {
                    name: foundFood.name,
                    serving: foundFood.serving || '1 serving',
                    servings: 1,
                    unitLabel: foundFood.serving || '1 serving',
                    unitMult: 1,
                    baseServing: foundFood.serving || '1 serving',
                    baseCal: foundFood.cal,
                    baseP: foundFood.p,
                    baseC: foundFood.c,
                    baseF: foundFood.f,
                    baseFiber: foundFood.fiber || 0,
                    baseSugar: foundFood.sugar || 0,
                    baseSatFat: foundFood.satFat || 0,
                    baseSodium: foundFood.sodium || 0,
                    cal: foundFood.cal,
                    p: foundFood.p,
                    c: foundFood.c,
                    f: foundFood.f,
                    fiber: foundFood.fiber||0,
                    sugar: foundFood.sugar||0,
                    satFat: foundFood.satFat||0,
                    sodium: foundFood.sodium||0,
                  });
                }}>
                <Text style={bsStyles.addBtnText}>Add to {meal}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={bsStyles.scanAgain} onPress={() => { setPhoto(null); setFoundFood(null); }}>
                <Text style={bsStyles.scanAgainText}>Scan Again</Text>
              </TouchableOpacity>

              {pendingBarcode && !contributeSuccess && (
                <View style={{ marginTop: 20 }}>
                  {!showContribute ? (
                    <TouchableOpacity
                      style={[bsStyles.scanAgain, { borderColor: C.accent, borderWidth: 1 }]}
                      onPress={() => setShowContribute(true)}
                    >
                      <Text style={[bsStyles.scanAgainText, { color: C.accent }]}>Add to Saudi Database</Text>
                    </TouchableOpacity>
                  ) : (
                    <View>
                      <Text style={{ color: C.t2, fontSize: 13, marginBottom: 6 }}>Product name</Text>
                      <TextInput
                        style={{ backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: C.t1, fontSize: 15, marginBottom: 10 }}
                        value={contributeName}
                        onChangeText={setContributeName}
                        placeholder="e.g. Almarai Full Fat Milk"
                        placeholderTextColor={C.t3}
                      />
                      <TouchableOpacity
                        style={[bsStyles.addBtn, contributeLoading && { opacity: 0.6 }]}
                        onPress={submitToDatabase}
                        disabled={contributeLoading}
                        activeOpacity={0.8}
                      >
                        <Text style={bsStyles.addBtnText}>{contributeLoading ? 'Submitting…' : 'Submit to Database'}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
              {contributeSuccess && (
                <Text style={{ color: '#30D158', textAlign: 'center', fontSize: 14, marginTop: 16 }}>
                  Submitted! The product is now in the Saudi database.
                </Text>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        ) : visible ? (
          <View style={{ flex: 1 }}>
            <CameraView
              style={lsStyles.camera}
              ref={cameraRef}
              facing="back"
              onCameraReady={() => setCameraReady(true)}
            />
            <View style={lsStyles.overlay} pointerEvents="none">
              <View style={lsStyles.labelFrame} />
              <Text style={lsStyles.hint}>{cameraReady ? 'Point at the nutrition facts table' : 'Starting camera…'}</Text>
            </View>
            <View style={lsStyles.captureRow} pointerEvents="box-none">
              <TouchableOpacity
                style={[lsStyles.captureBtn, (!cameraReady || loading) && { opacity: 0.4 }]}
                onPress={takePhoto}
                disabled={!cameraReady || loading}
                activeOpacity={0.8}
              >
                <View style={lsStyles.captureBtnInner} />
              </TouchableOpacity>
              {loading && (
                <View style={{ position:'absolute', top:0, left:0, right:0, bottom:0, backgroundColor:'rgba(0,0,0,0.6)', alignItems:'center', justifyContent:'center' }}>
                  <AISpinner />
                </View>
              )}
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function EditFoodSheet({ item, onSave, onDelete, onClose }) {
  const C = useContext(ThemeContext);
  const ssStyles = mkSsStyles(C);
  const { ty, dragHandle } = useSwipeDismiss(onClose);
  const base = {
    cal:    item.baseCal    ?? item.cal,
    p:      item.baseP      ?? item.p,
    c:      item.baseC      ?? item.c,
    f:      item.baseF      ?? item.f,
    fiber:  item.baseFiber  ?? item.fiber  ?? 0,
    sugar:  item.baseSugar  ?? item.sugar  ?? 0,
    satFat: item.baseSatFat ?? item.satFat ?? 0,
    sodium: item.baseSodium ?? item.sodium ?? 0,
  };
  const [servings, setServings] = useState(String(item.servings ?? 1));
  const [unitMult, setUnitMult] = useState(item.unitMult ?? 1);
  const [unitLabel, setUnitLabel] = useState(item.unitLabel || item.serving || '');
  const [showUnitPicker, setShowUnitPicker] = useState(false);
  const sv  = Math.max(0.01, parseFloat(servings) || 1) * unitMult;
  const cal    = Math.round(base.cal    * sv);
  const p      = Math.round(base.p      * sv);
  const c      = Math.round(base.c      * sv);
  const f      = Math.round(base.f      * sv);
  const fiber  = Math.round(base.fiber  * sv);
  const sugar  = Math.round(base.sugar  * sv);
  const satFat = Math.round(base.satFat * sv);
  const sodium = Math.round(base.sodium * sv);
  const baseServing = item.baseServing || item.serving || item.unitLabel || '1 serving';

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={ssStyles.modalWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={ssStyles.backdrop} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[ssStyles.sheet, { transform: [{ translateY: ty }] }]}>
          <View style={ssStyles.dragArea} {...dragHandle}>
            <View style={ssStyles.handle} />
          </View>
          <View style={ssStyles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={ssStyles.title}>{item.name}</Text>
              {!!item.serving && <Text style={ssStyles.subtitle}>Per {item.serving}</Text>}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close-circle" size={24} color={C.t3} />
            </TouchableOpacity>
          </View>

          <View style={{ zIndex: 20 }}>
            <TouchableOpacity style={ssStyles.servingsRow} activeOpacity={0.75} onPress={() => setShowUnitPicker(v => !v)}>
              <Text style={ssStyles.servingsLbl}>Serving Size</Text>
              <View style={ssStyles.valuePill}>
                <Text style={ssStyles.valuePillText}>{unitLabel || baseServing}</Text>
                <Ionicons name={showUnitPicker ? 'chevron-up' : 'chevron-down'} size={13} color={C.accent} />
              </View>
            </TouchableOpacity>
            {showUnitPicker && (
              <View style={ssStyles.dropdown}>
                <ScrollView bounces={false} showsVerticalScrollIndicator indicatorStyle="white" scrollIndicatorInsets={{ top: 6, bottom: 6, right: 2 }} keyboardShouldPersistTaps="handled">
                  {servingOptionsFor(baseServing).map((option, idx) => {
                    const active = (unitLabel || String(baseServing).replace(/\s+/g, ' ').trim()) === option.label;
                    return (
                      <TouchableOpacity
                        key={option.label}
                        style={[ssStyles.dropdownRow, idx > 0 && ssStyles.dropdownDivider]}
                        activeOpacity={0.75}
                        onPress={() => { setUnitLabel(option.label); setUnitMult(option.mult); setShowUnitPicker(false); }}
                      >
                        <Text style={ssStyles.dropdownText}>{option.label}</Text>
                        {active && <Ionicons name="checkmark-circle" size={18} color={C.accent} />}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}
          </View>

          <View style={ssStyles.servingsRow}>
            <Text style={ssStyles.servingsLbl}>Servings</Text>
            <View style={ssStyles.stepper}>
              <TouchableOpacity hitSlop={10} onPress={() => setServings(s => String(Math.max(0.01, (parseFloat(s)||1) - 0.5)))}>
                <Ionicons name="remove-circle" size={32} color={C.accent} />
              </TouchableOpacity>
              <TextInput
                style={ssStyles.servingsInput}
                value={servings}
                onChangeText={setServings}
                keyboardType="decimal-pad"
                selectTextOnFocus
              />
              <TouchableOpacity hitSlop={10} onPress={() => setServings(s => String((parseFloat(s)||1) + 0.5))}>
                <Ionicons name="add-circle" size={32} color={C.accent} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={ssStyles.macroRow}>
            {[
              { label: 'Calories', val: cal, unit: '' },
              { label: 'Protein',  val: p,   unit: 'g' },
              { label: 'Carbs',    val: c,   unit: 'g' },
              { label: 'Fat',      val: f,   unit: 'g' },
            ].map(m => (
              <View key={m.label} style={ssStyles.macroItem}>
                <Text style={ssStyles.macroVal}>{m.val}{m.unit}</Text>
                <Text style={ssStyles.macroLbl}>{m.label}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={ssStyles.saveBtn} activeOpacity={0.8}
            onPress={() => onSave({
              ...item,
              serving: unitLabel || baseServing,
              unitLabel: unitLabel || baseServing,
              unitMult,
              baseServing,
              servings: Math.max(0.01, parseFloat(servings) || 1),
              cal, p, c, f, fiber, sugar, satFat, sodium,
              baseCal: base.cal,
              baseP: base.p,
              baseC: base.c,
              baseF: base.f,
              baseFiber: base.fiber,
              baseSugar: base.sugar,
              baseSatFat: base.satFat,
              baseSodium: base.sodium,
            })}>
            <Text style={ssStyles.saveBtnText}>Save Changes</Text>
          </TouchableOpacity>
          <TouchableOpacity style={ssStyles.deleteBtn} activeOpacity={0.8} onPress={() => Alert.alert('Remove Food', 'Remove this item from your diary?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: onDelete }])}>
            <Text style={ssStyles.deleteBtnText}>Remove from Diary</Text>
          </TouchableOpacity>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function MealDetailModal({ meal, onClose, goals }) {
  const C = useContext(ThemeContext);
  const mdStyles = mkMdStyles(C);
  const mP   = meal.items.reduce((s, i) => s + i.p,   0);
  const mC   = meal.items.reduce((s, i) => s + i.c,   0);
  const mF   = meal.items.reduce((s, i) => s + i.f,   0);
  const mCal = meal.items.reduce((s, i) => s + i.cal, 0);
  const macroCal = mP * 4 + mC * 4 + mF * 9;
  const { ty, dragHandle } = useSwipeDismiss(onClose);

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={mdStyles.modalWrap}>
        <TouchableOpacity style={mdStyles.backdrop} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[mdStyles.sheet, { transform: [{ translateY: ty }] }]}>
          <View style={mdStyles.dragArea} {...dragHandle}>
            <View style={mdStyles.handle} />
          </View>
          <View style={mdStyles.header}>
            <Text style={mdStyles.title}>{meal.name}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close-circle" size={24} color={C.t3} />
            </TouchableOpacity>
          </View>

          {/* Macros card with blue left bar + camera button */}
          <View style={{ marginHorizontal: 16, marginBottom: 12, borderRadius: 16, overflow: 'hidden', backgroundColor: C.surface }}>
            <View style={{ flexDirection: 'row', overflow: 'hidden' }}>
              <View style={{ width: 4, backgroundColor: C.accent }} />
              <View style={{ flex: 1, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4 }}>
                <View style={{ marginBottom: 14 }}>
                  <Text style={{ fontSize: 22, fontWeight: '800', color: C.t1, letterSpacing: -0.5 }}>
                    {mCal} <Text style={{ fontSize: 14, fontWeight: '500', color: C.t3 }}>kcal</Text>
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingBottom: 14 }}>
                  {[
                    { name: 'Protein', color: '#FFB340', total: mP, goal: goals?.protein ?? 180, pct: macroCal > 0 ? (mP * 4) / macroCal : 0 },
                    { name: 'Carbs',   color: '#30D158', total: mC, goal: goals?.carbs   ?? 250, pct: macroCal > 0 ? (mC * 4) / macroCal : 0 },
                    { name: 'Fat',     color: '#BF5AF2', total: mF, goal: goals?.fat     ?? 70,  pct: macroCal > 0 ? (mF * 9) / macroCal : 0 },
                  ].map(m => {
                    const goalPct = m.goal > 0 ? Math.min(m.total / m.goal, 1) : 0;
                    return (
                      <View key={m.name} style={{ alignItems: 'center', gap: 6 }}>
                        <View style={{ width: 80, height: 80, alignItems: 'center', justifyContent: 'center' }}>
                          <AnimatedRingProgress size={80} stroke={7} progress={goalPct} color={m.color} />
                          <View style={{ position: 'absolute', alignItems: 'center' }}>
                            <Text style={{ color: m.color, fontSize: 15, fontWeight: '800' }}>{Math.round(m.total)}g</Text>
                            <Text style={{ color: C.t3, fontSize: 9 }}>of {m.goal}g</Text>
                          </View>
                        </View>
                        <View style={{ backgroundColor: m.color + '22', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <Text style={{ fontSize: 10, fontWeight: '700', color: m.color }}>{m.name}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            </View>
          </View>

          {meal.items.length > 0 ? (
            <ScrollView style={mdStyles.itemsScroll} showsVerticalScrollIndicator={false}>
              <View style={{ marginHorizontal: 16, borderRadius: 16, overflow: 'hidden', backgroundColor: C.surface, marginBottom: 24 }}>
                {meal.items.map((item, i) => (
                  <View key={i}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={mdStyles.itemName}>{item.name}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
                          <Text style={{ fontSize: 11, color: C.t3 }}>{item.cal} cal</Text>
                          {[{ label: `${item.p}p`, color: '#FFB340' }, { label: `${item.c}c`, color: '#30D158' }, { label: `${item.f}f`, color: '#BF5AF2' }].map(chip => (
                            <View key={chip.label} style={{ backgroundColor: chip.color + '22', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: chip.color }}>{chip.label}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    </View>
                    {i < meal.items.length - 1 && <View style={mdStyles.sep} />}
                  </View>
                ))}
              </View>
            </ScrollView>
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: 32 }}>
              <Ionicons name="nutrition-outline" size={32} color={C.t3} style={{ marginBottom: 8, opacity: 0.4 }} />
              <Text style={{ fontSize: 14, color: C.t3 }}>No foods logged yet</Text>
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

// ── AI MEAL SCAN MODAL ────────────────────────────────────
function MealScanModal({ visible, meal, onClose, onAddAllFoods }) {
  const C = useContext(ThemeContext);
  const bsStyles = mkBsStyles(C);
  const lsStyles = mkLsStyles(C);
  const msStyles = mkMsStyles(C);
  const [permission, requestPermission] = useCameraPermissions();
  const [loading,     setLoading]     = useState(false);
  const [foundFoods,  setFoundFoods]  = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const cameraRef = useRef(null);
  const insets    = useSafeAreaInsets();

  useEffect(() => { if (!visible) { setFoundFoods(null); setLoading(false); setCameraReady(false); } }, [visible]);

  const takePhoto = async () => {
    if (!cameraRef.current || !cameraReady) return;
    try {
      const pic = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.4 });
      await analyseMeal(pic.base64);
    } catch (e) {
      Alert.alert('Capture failed', e?.message || 'Could not take photo. Try again.');
      return;
    }
  };

  const pickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Photo Access Needed',
        'Allow photo access to choose a meal photo for analysis.',
        permission.canAskAgain === false
          ? [{ text: 'Cancel', style: 'cancel' }, { text: 'Open Settings', onPress: () => Linking.openSettings() }]
          : [{ text: 'OK' }]
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.4,
    });
    if (!result.canceled && result.assets?.[0]?.base64) {
      await analyseMeal(result.assets[0].base64);
    }
  };

  const analyseMeal = async (base64) => {
    setLoading(true);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(AI_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Identify every food or dish visible in this meal photo and estimate the nutrition for each portion shown. Return ONLY a valid JSON array — no explanation, no markdown: [{"name":"food name","serving":"estimated portion","cal":number,"p":number,"c":number,"f":number}]' },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
            ],
          }],
          max_tokens: 600,
        }),
      });
      clearTimeout(timer);
      const json  = await res.json();
      if (json.error) {
        Alert.alert('AI Error', json.error.message || JSON.stringify(json.error));
        setLoading(false);
        return;
      }
      const text  = json.choices?.[0]?.message?.content || '';
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        const foods = JSON.parse(match[0]);
        if (Array.isArray(foods) && foods.length > 0) {
          setFoundFoods(foods);
        } else {
          Alert.alert('No foods detected', 'Could not identify any foods. Try again with better lighting.');
        }
      } else {
        Alert.alert('Could not analyse meal', text || 'Try pointing directly at your plate.');
      }
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to analyse meal. Check your connection.');
    }
    setLoading(false);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[lsStyles.screen, { paddingTop: insets.top }]}>
        <SwipeBackEdge onBack={onClose} />
        <StatusBar barStyle={C.statusBar} />
        <View style={lsStyles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={12}><Text style={lsStyles.cancel}>Cancel</Text></TouchableOpacity>
          <Text style={lsStyles.title}>AI Meal Scan</Text>
          <View style={{ width: 60 }} />
        </View>

        {(!permission || !permission.granted) ? (
          <View style={bsStyles.permWrap}>
            <Text style={bsStyles.permTitle}>Camera Access Needed</Text>
            <Text style={bsStyles.permSub}>Required to scan your meal</Text>
            {permission?.canAskAgain !== false ? (
              <TouchableOpacity style={bsStyles.permBtn} onPress={requestPermission}>
                <Text style={bsStyles.permBtnText}>Allow Camera</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={bsStyles.permBtn} onPress={() => Linking.openSettings()}>
                <Text style={bsStyles.permBtnText}>Open Settings</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : foundFoods ? (
          <View style={bsStyles.resultWrap}>
            <Text style={msStyles.resultsTitle}>Detected in your meal</Text>
            <ScrollView style={msStyles.foodList} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
              {foundFoods.map((food, i) => (
                <View key={i} style={msStyles.foodRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={msStyles.foodName}>{food.name}</Text>
                    <Text style={msStyles.foodSub}>{food.serving} · {food.p}p · {food.c}c · {food.f}f</Text>
                  </View>
                  <Text style={msStyles.foodCal}>{food.cal} <Text style={msStyles.calUnit}>kcal</Text></Text>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={bsStyles.addBtn} activeOpacity={0.8} onPress={() => onAddAllFoods(meal, foundFoods)}>
              <Text style={bsStyles.addBtnText}>Add All to {meal}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={bsStyles.scanAgain} onPress={() => setFoundFoods(null)}>
              <Text style={bsStyles.scanAgainText}>Scan Again</Text>
            </TouchableOpacity>
          </View>
        ) : visible ? (
          <View style={{ flex: 1 }}>
            <CameraView
              style={lsStyles.camera}
              ref={cameraRef}
              facing="back"
              onCameraReady={() => setCameraReady(true)}
            />
            <View style={lsStyles.overlay} pointerEvents="none">
              <View style={msStyles.plateFrame} />
              <Text style={lsStyles.hint}>{cameraReady ? 'Point at your full plate' : 'Starting camera…'}</Text>
            </View>
            <View style={lsStyles.captureRow} pointerEvents="box-none">
              <TouchableOpacity
                style={[msStyles.uploadBtn, !cameraReady && { opacity: 0.4 }]}
                onPress={pickPhoto}
                disabled={loading || !cameraReady}
                activeOpacity={0.7}
              >
                <Ionicons name="image-outline" size={26} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={[lsStyles.captureBtn, (!cameraReady || loading) && { opacity: 0.4 }]}
                onPress={takePhoto}
                disabled={!cameraReady || loading}
                activeOpacity={0.8}
              >
                <View style={lsStyles.captureBtnInner} />
              </TouchableOpacity>
              <View style={{ width: 52 }} />
            </View>
            {loading && (
              <View style={{ position:'absolute', top:0, left:0, right:0, bottom:0, backgroundColor:'rgba(0,0,0,0.6)', alignItems:'center', justifyContent:'center' }}>
                <AISpinner />
              </View>
            )}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function NutritionScreen() {
  const insets = useSafeAreaInsets();
  const C = useContext(ThemeContext);
  const styles = mkStyles(C);
  const nutStyles = mkNutStyles(C);
  const dpStyles = mkDpStyles(C);
  const [tab,           setTab]           = useState('Calories');
  const [addingTo,      setAddingTo]      = useState(null);
  const [mealDetail,    setMealDetail]    = useState(null);
  const [editingItem,   setEditingItem]   = useState(null);
  const [labelScanning,   setLabelScanning]   = useState(false);
  const [scanBarcode,     setScanBarcode]     = useState(null);
  const [mealScanning,    setMealScanning]    = useState(false);
  const [barcodeScanning, setBarcodeScanning] = useState(false);
  const [scanTarget,      setScanTarget]      = useState(null);
  const [showDatePicker,setShowDatePicker]= useState(false);
  const [selectedDate,  setSelectedDate]  = useState(todayStr());
  const selectedDateObj = new Date(selectedDate + 'T12:00:00');
  const currentYear = new Date().getFullYear();
  const [pickerDay,   setPickerDay]   = useState(selectedDateObj.getDate());
  const [pickerMonth, setPickerMonth] = useState(selectedDateObj.getMonth());
  const [pickerYear,  setPickerYear]  = useState(selectedDateObj.getFullYear());
  const [pickerKey,   setPickerKey]   = useState(0);
  const initialCalendarMonth = todayStr().slice(0, 7) + '-01';
  const [calendarMonth, setCalendarMonth] = useState(initialCalendarMonth);
  const [preparedCalendarMonths, setPreparedCalendarMonths] = useState(() => monthWindow(initialCalendarMonth));
  const [meals,         setMeals]         = useState(EMPTY_MEALS);
  const [customFoods,   setCustomFoods]   = useState([]);
  const [goals,         setGoals]         = useState(DEFAULT_GOALS);
  const [sharingMeal,   setSharingMeal]   = useState(null);
  const [logEditMode,   setLogEditMode]   = useState(false);
  const [selectedLogItems, setSelectedLogItems] = useState({});
  const [pendingDelete, setPendingDelete] = useState(false);
  const customFoodsLoaded = useRef(false);
  const [toastMsg,    setToastMsg]    = useState('');
  const toastOpacity  = useRef(new Animated.Value(0)).current;
  const toastY        = useRef(new Animated.Value(8)).current;
  const toastTimer    = useRef(null);
  const [undoData,    setUndoData]    = useState(null);
  const undoTimer     = useRef(null);

  const showToast = (msg, withUndo = false) => {
    clearTimeout(toastTimer.current);
    clearTimeout(undoTimer.current);
    if (!withUndo) setUndoData(null);
    setToastMsg(msg);
    toastOpacity.setValue(0);
    toastY.setValue(8);
    Animated.parallel([
      Animated.timing(toastOpacity, { toValue: 1, duration: 140, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(toastY, { toValue: 0, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    const delay = withUndo ? 4000 : 2000;
    toastTimer.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(toastOpacity, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(toastY, { toValue: 8, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ]).start(() => setUndoData(null));
    }, delay);
  };

  useEffect(() => () => { clearTimeout(toastTimer.current); clearTimeout(undoTimer.current); }, []);

  useFocusEffect(useCallback(() => {
    AsyncStorage.multiGet(['customFoods', GOALS_KEY]).then(([[,cRaw],[,gRaw]]) => {
      setCustomFoods(parseStoredJson(cRaw, []));
      customFoodsLoaded.current = true;
      if (gRaw) setGoals(parseStoredJson(gRaw, DEFAULT_GOALS));
    });
    return () => setSharingMeal(null);
  }, []));

  useEffect(() => {
    AsyncStorage.getItem(`meals_${selectedDate}`).then(d => {
      setMeals(parseStoredJson(d, EMPTY_MEALS));
    });
    setLogEditMode(false);
    setSelectedLogItems({});
  }, [selectedDate]);


  useEffect(() => {
    if (!customFoodsLoaded.current) return;
    setJson('customFoods', customFoods);
  }, [customFoods]);

  const saveMeals = useCallback((nextMeals) => {
    setMeals(prevMeals => {
      const updated = typeof nextMeals === 'function' ? nextMeals(prevMeals) : nextMeals;
      setJson(`meals_${selectedDate}`, updated);
      return updated;
    });
  }, [selectedDate]);

  const addFood = (mealName, food) => {
    saveMeals(currentMeals => currentMeals.map(m => m.name === mealName ? { ...m, items: [...m.items, food] } : m));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    showToast(`Added to ${mealName}`);
    setAddingTo(null);
    setLabelScanning(false);
    setBarcodeScanning(false);
    setScanBarcode(null);
    setScanTarget(null);
  };

  const quickAddFood = (mealName, food) => {
    saveMeals(currentMeals => currentMeals.map(m => m.name === mealName ? { ...m, items: [...m.items, food] } : m));
    showToast(`Added to ${mealName}`);
  };

  const selectionKey = (mealName, idx) => `${mealName}::${idx}`;
  const selectedCount = Object.keys(selectedLogItems).length;
  const totalLoggedItems = meals.reduce((sum, meal) => sum + meal.items.length, 0);
  const allLoggedSelected = totalLoggedItems > 0 && selectedCount === totalLoggedItems;

  const toggleLogSelection = (mealName, idx) => {
    const key = selectionKey(mealName, idx);
    setSelectedLogItems(prev => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  };

  const enterLogEditMode = (mealName, idx) => {
    setLogEditMode(true);
    setSelectedLogItems({ [selectionKey(mealName, idx)]: true });
  };

  const toggleSelectAllLogs = () => {
    if (allLoggedSelected) {
      setSelectedLogItems({});
      return;
    }
    const next = {};
    meals.forEach(meal => meal.items.forEach((_, idx) => { next[selectionKey(meal.name, idx)] = true; }));
    setSelectedLogItems(next);
  };

  const exitLogEditMode = () => {
    setLogEditMode(false);
    setSelectedLogItems({});
    setPendingDelete(false);
  };

  const confirmDeleteLogs = () => {
    saveMeals(currentMeals => currentMeals.map(meal => ({
      ...meal,
      items: meal.items.filter((_, idx) => !selectedLogItems[selectionKey(meal.name, idx)]),
    })));
    exitLogEditMode();
  };

  const deleteFoodDirect = (mealName, idx) => {
    const meal = meals.find(m => m.name === mealName);
    const deletedItem = meal?.items[idx];
    saveMeals(m => m.map(ml => ml.name === mealName ? { ...ml, items: ml.items.filter((_, i) => i !== idx) } : ml));
    if (deletedItem) {
      setUndoData({ mealName, idx, item: deletedItem });
      showToast('Removed', true);
    }
  };

  const updateFood = (mealName, idx, updatedItem) => {
    saveMeals(currentMeals => currentMeals.map(m =>
      m.name === mealName ? { ...m, items: m.items.map((it, i) => i === idx ? updatedItem : it) } : m
    ));
    setEditingItem(null);
  };


  const addCustomFood = (food) => setCustomFoods(prev =>
    prev.some(f => f.name.toLowerCase() === food.name.toLowerCase()) ? prev : [...prev, food]
  );
  const editCustomFood = (food) => setCustomFoods(prev => prev.map(f => f.id === food.id ? food : f));
  const deleteCustomFood = (id) => setCustomFoods(prev => prev.filter(f => f.id !== id));

  const scrollRef      = useRef(null);
  const calScrollRef   = useRef(null);
  const nutriScrollRef = useRef(null);
  const macroScrollRef = useRef(null);
  const dayWheelRef = useRef(null);
  const monthWheelRef = useRef(null);
  const yearWheelRef = useRef(null);
  const calendarSwipeLocked = useRef(false);
  const datePickerAnim = useRef(new Animated.Value(0)).current;
  const dpSwipeTy = useRef(new Animated.Value(0)).current;
  const dpSwipePan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, { dy, dx }) => dy > 6 && dy > Math.abs(dx),
    onPanResponderMove: (_, { dy }) => { if (dy > 0) dpSwipeTy.setValue(dy); },
    onPanResponderRelease: (_, { dy, vy }) => {
      if (dy > 100 || vy > 1.2) {
        dpSwipeTy.setValue(0);
        closeDatePicker();
      } else {
        Animated.spring(dpSwipeTy, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
      }
    },
  })).current;
  const calendarSettleOpacity = useRef(new Animated.Value(1)).current;
  const SWIPE_TABS  = ['Calories', 'Nutrients', 'Macros'];
  const screenW     = Dimensions.get('window').width;
  const calendarPageW = screenW - 36;
  const calendarDragX = useRef(new Animated.Value(-calendarPageW)).current;
  const WHEEL_ITEM_H = 38;
  const WHEEL_VISIBLE_H = WHEEL_ITEM_H * 5;
  const YEAR_RANGE = 5;
  const pickerYears = useMemo(() => {
    const min = currentYear - YEAR_RANGE;
    const max = currentYear + YEAR_RANGE;
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }, [currentYear]);
  const pickerDays = useMemo(() => Array.from({ length: daysInMonth(pickerYear, pickerMonth) }, (_, i) => i + 1), [pickerMonth, pickerYear]);
  const pickerDateString = useMemo(() => dateStrFromParts(pickerYear, pickerMonth, Math.min(pickerDay, daysInMonth(pickerYear, pickerMonth))), [pickerDay, pickerMonth, pickerYear]);

  const scrollWheelTo = useCallback((ref, index, animated = false) => {
    requestAnimationFrame(() => {
      ref.current?.scrollToIndex?.({ index: Math.max(0, index), animated });
    });
  }, []);

  const syncWheelPositions = useCallback((day, month, year, animated = false) => {
    scrollWheelTo(dayWheelRef, day - 1, animated);
    scrollWheelTo(monthWheelRef, month, animated);
    const yearIndex = pickerYears.indexOf(year);
    scrollWheelTo(yearWheelRef, yearIndex >= 0 ? yearIndex : YEAR_RANGE, animated);
  }, [pickerYears, scrollWheelTo]);

  const setPickerDateParts = useCallback((date, animated = false) => {
    const dt = new Date(date + 'T12:00:00');
    const day = dt.getDate();
    const month = dt.getMonth();
    const minYear = pickerYears[0] ?? currentYear - YEAR_RANGE;
    const maxYear = pickerYears[pickerYears.length - 1] ?? currentYear + YEAR_RANGE;
    const year = Math.max(minYear, Math.min(maxYear, dt.getFullYear()));
    setPickerDay(day);
    setPickerMonth(month);
    setPickerYear(year);
    setPickerKey(k => k + 1);
    setTimeout(() => syncWheelPositions(day, month, year, animated), 0);
  }, [currentYear, pickerYears, syncWheelPositions]);

  const clampPickerDay = useCallback((year, month) => {
    setPickerDay(day => Math.min(day, daysInMonth(year, month)));
  }, []);

  const onWheelMomentumEnd = useCallback((event, values, setter) => {
    const index = Math.round(event.nativeEvent.contentOffset.y / WHEEL_ITEM_H);
    const value = values[Math.max(0, Math.min(values.length - 1, index))];
    if (value != null) setter(value);
  }, []);

  const renderWheelItem = useCallback(({ item, active, label }) => (
    <View style={dpStyles.wheelItem}>
      <Text style={[dpStyles.wheelText, active && dpStyles.wheelTextActive]}>{label || item}</Text>
    </View>
  ), []);

  const innerScrollRefs = { Calories: calScrollRef, Nutrients: nutriScrollRef, Macros: macroScrollRef };
  const handleTabPress = (t) => {
    const idx = SWIPE_TABS.indexOf(t);
    setTab(t);
    scrollRef.current?.scrollTo({ x: idx * screenW, animated: true });
    innerScrollRefs[t]?.current?.scrollTo({ y: 0, animated: false });
  };

  const handleScrollEnd = (e) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / screenW);
    const t = SWIPE_TABS[idx];
    setTab(t);
    innerScrollRefs[t]?.current?.scrollTo({ y: 0, animated: false });
  };

  const addAllFoods = (mealName, foods) => {
    saveMeals(currentMeals => currentMeals.map(m =>
      m.name === mealName ? { ...m, items: [...m.items, ...foods.map(f => ({
        name: f.name,
        serving: f.serving || '1 serving',
        servings: 1,
        unitLabel: f.serving || '1 serving',
        unitMult: 1,
        baseServing: f.serving || '1 serving',
        baseCal: f.cal,
        baseP: f.p,
        baseC: f.c,
        baseF: f.f,
        baseFiber: f.fiber || 0,
        baseSugar: f.sugar || 0,
        baseSatFat: f.satFat || 0,
        baseSodium: f.sodium || 0,
        cal: f.cal,
        p: f.p,
        c: f.c,
        f: f.f,
        fiber: f.fiber || 0,
        sugar: f.sugar || 0,
        satFat: f.satFat || 0,
        sodium: f.sodium || 0,
      }))] } : m
    ));
    setMealScanning(false);
    setScanTarget(null);
  };

  const nutritionTotals = useMemo(() => {
    return meals.reduce((totals, meal) => {
      for (const item of meal.items) {
        totals.consumed += item.cal || 0;
        totals.p        += item.p || 0;
        totals.c        += item.c || 0;
        totals.f        += item.f || 0;
        totals.fiber    += item.fiber || 0;
        totals.sugar    += item.sugar || 0;
        totals.satFat   += item.satFat || 0;
        totals.sodium   += item.sodium || 0;
      }
      return totals;
    }, { consumed: 0, p: 0, c: 0, f: 0, fiber: 0, sugar: 0, satFat: 0, sodium: 0 });
  }, [meals]);

  const goal          = goals.calories;
  const consumed      = nutritionTotals.consumed;
  const remaining     = goal - consumed;
  const totalP        = nutritionTotals.p;
  const totalC        = nutritionTotals.c;
  const totalF        = nutritionTotals.f;
  const totalFiber    = nutritionTotals.fiber;
  const totalSugar    = nutritionTotals.sugar;
  const totalSatFat   = nutritionTotals.satFat;
  const totalSodium   = nutritionTotals.sodium;

  const NUTRIENTS = useMemo(() => [
    { name: 'Protein',       color: '#FFB340', total: totalP,      goal: goals.protein, unit: 'g'  },
    { name: 'Carbohydrates', color: '#30D158', total: totalC,      goal: goals.carbs,   unit: 'g'  },
    { name: 'Fat',           color: '#BF5AF2', total: totalF,      goal: goals.fat,     unit: 'g'  },
    { name: 'Fiber',         color: '#32ADE6', total: totalFiber,  goal: goals.fiber  ?? 28,   unit: 'g'  },
    { name: 'Sugar',         color: '#FF9F0A', total: totalSugar,  goal: goals.sugar  ?? 50,   unit: 'g'  },
    { name: 'Saturated Fat', color: '#FF453A', total: totalSatFat, goal: goals.satFat ?? 20,   unit: 'g'  },
    { name: 'Sodium',        color: '#98989E', total: totalSodium, goal: goals.sodium ?? 2300, unit: 'mg' },
  ], [goals, totalP, totalC, totalF, totalFiber, totalSugar, totalSatFat, totalSodium]);

  const calendarMonthLabel = useMemo(() => {
    return new Date(calendarMonth + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }, [calendarMonth]);

  const monthFromOffset = useCallback((month, offset) => {
    return shiftMonth(month, offset);
  }, []);

  const buildCalendarDays = useCallback((month) => {
    const monthDate = new Date(month + 'T12:00:00');
    const y = monthDate.getFullYear();
    const m = monthDate.getMonth();
    const firstDay = new Date(y, m, 1).getDay();
    return Array.from({ length: 42 }, (_, i) => {
      const day = i - firstDay + 1;
      const cellDate = new Date(y, m, day);
      const date = dateStrFromParts(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate());
      return {
        date,
        day: cellDate.getDate(),
        inMonth: cellDate.getMonth() === m,
        isToday: date === todayStr(),
        active: date === selectedDate,
      };
    });
  }, [selectedDate]);

  const preparedCalendarPages = useMemo(() => (
    preparedCalendarMonths.map(month => ({ month, days: buildCalendarDays(month) }))
  ), [buildCalendarDays, preparedCalendarMonths]);

  const shiftCalendarMonth = (delta) => {
    setCalendarMonth(current => {
      const next = monthFromOffset(current, delta);
      setPreparedCalendarMonths(monthWindow(next));
      return next;
    });
  };

  const settleCalendarDrag = () => {
    Animated.timing(calendarDragX, {
      toValue: -calendarPageW,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const animateCalendarMonth = (delta) => {
    if (calendarSwipeLocked.current) return;
    calendarSwipeLocked.current = true;
    Animated.timing(calendarDragX, {
      toValue: delta > 0 ? -calendarPageW * 2 : 0,
      duration: 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      Animated.timing(calendarSettleOpacity, {
        toValue: 0,
        duration: 45,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        shiftCalendarMonth(delta);
        calendarDragX.setValue(-calendarPageW);
        requestAnimationFrame(() => {
          Animated.timing(calendarSettleOpacity, {
            toValue: 1,
            duration: 85,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start(() => {
            calendarSwipeLocked.current = false;
          });
        });
      });
    });
  };

  const calendarPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) =>
      Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.25,
    onPanResponderMove: (_, gesture) => {
      if (calendarSwipeLocked.current) return;
      const drag = Math.max(-calendarPageW, Math.min(calendarPageW, gesture.dx));
      calendarDragX.setValue(-calendarPageW + drag);
    },
    onPanResponderRelease: (_, gesture) => {
      if (Math.abs(gesture.dx) < 52) {
        settleCalendarDrag();
        return;
      }
      animateCalendarMonth(gesture.dx < 0 ? 1 : -1);
    },
    onPanResponderTerminate: settleCalendarDrag,
  }), [calendarDragX, calendarPageW, settleCalendarDrag, animateCalendarMonth]);

  const openDatePicker = () => {
    setPickerDateParts(selectedDate, false);
    datePickerAnim.setValue(0);
    setShowDatePicker(true);
    requestAnimationFrame(() => {
      Animated.timing(datePickerAnim, {
        toValue: 1,
        duration: 170,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  };

  const closeDatePicker = () => {
    Animated.timing(datePickerAnim, {
      toValue: 0,
      duration: 140,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => setShowDatePicker(false));
  };

  const confirmDatePicker = () => {
    setSelectedDate(pickerDateString);
    closeDatePicker();
  };

  const jumpPickerToToday = () => {
    setPickerDateParts(todayStr(), true);
  };

  const datePickerSheetStyle = {
    opacity: datePickerAnim,
    transform: [
      { translateY: datePickerAnim.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) },
      { translateY: dpSwipeTy },
    ],
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: C.bg }]}>
      <StatusBar barStyle={C.statusBar} />

      {/* ── HEADER ── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
        <Text style={{ fontSize: 28, fontWeight: '800', color: C.t1, letterSpacing: -0.8 }}>Nutrition</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          {tab === 'Calories' && (logEditMode ? (
            <>
              <TouchableOpacity onPress={toggleSelectAllLogs} hitSlop={12} disabled={totalLoggedItems === 0}>
                <Text style={{ fontSize: 14, color: totalLoggedItems === 0 ? C.t3 : C.accent, fontWeight: '600' }}>
                  {allLoggedSelected ? 'Deselect' : 'Select All'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={exitLogEditMode} hitSlop={12}>
                <Text style={{ fontSize: 14, color: C.accent, fontWeight: '700' }}>Done</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity onPress={() => setLogEditMode(true)} hitSlop={12} disabled={totalLoggedItems === 0}>
              <Text style={{ fontSize: 14, color: totalLoggedItems === 0 ? C.t3 : C.accent, fontWeight: '600' }}>Edit</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── TABS ── */}
      <View style={[nutStyles.tabBar, { backgroundColor: C.surface }]}>
        {SWIPE_TABS.map(t => {
          const lockedByEdit = logEditMode && t !== 'Calories';
          return (
            <TouchableOpacity key={t} style={nutStyles.tabItem} onPress={() => !lockedByEdit && handleTabPress(t)} activeOpacity={lockedByEdit ? 1 : 0.7}>
              <Text style={[nutStyles.tabText, tab === t && nutStyles.tabTextActive, lockedByEdit && { color: C.t3, opacity: 0.4 }]}>{t}</Text>
              {tab === t && <View style={nutStyles.tabUnderline} />}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── DATE NAV ── */}
      <View style={nutStyles.dateBar}>
        <TouchableOpacity hitSlop={12} onPress={() => setSelectedDate(d => shiftDay(d, -1))}>
          <Ionicons name="chevron-back" size={22} color={C.t2} />
        </TouchableOpacity>
        <TouchableOpacity style={nutStyles.datePill} onPress={openDatePicker} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 18, right: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[nutStyles.dateText, selectedDate === todayStr() && { color: C.accent }]}>{displayDate(selectedDate)}</Text>
            <Ionicons name="chevron-down" size={13} color={selectedDate === todayStr() ? C.accent : C.t3} />
          </View>
        </TouchableOpacity>
        <TouchableOpacity hitSlop={12} onPress={() => setSelectedDate(d => shiftDay(d, 1))}>
          <Ionicons name="chevron-forward" size={22} color={C.t2} />
        </TouchableOpacity>
      </View>

      {/* ── SWIPEABLE TABS ── */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        scrollEnabled={!logEditMode}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScrollEnd}
        style={{ flex: 1 }}
      >

        {/* ── CALORIES ── */}
        <ScrollView ref={calScrollRef} style={{ width: screenW }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          <TouchableOpacity style={[nutStyles.card, { backgroundColor: C.surface, marginTop: 12 }]} activeOpacity={0.85} onPress={() => handleTabPress('Nutrients')}><View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
            <View style={nutStyles.blockTitleRow}>
              <Text style={nutStyles.blockTitle}>Calories Remaining</Text>
            </View>
            <View style={nutStyles.formula}>
              {[
                { val: goal.toLocaleString(), lbl: 'Goal' },
                { val: '–', op: true },
                { val: consumed.toLocaleString(), lbl: 'Food' },
                { val: '=', op: true },
                { val: remaining < 0 ? `-${Math.abs(remaining).toLocaleString()}` : remaining.toLocaleString(), lbl: remaining < 0 ? 'Over' : 'Remaining', accent: true, over: remaining < 0 },
              ].map((item, i) =>
                item.op
                  ? <Text key={i} style={nutStyles.formulaOp}>{item.val}</Text>
                  : <View key={i} style={nutStyles.formulaItem}>
                      <Text style={[nutStyles.formulaNum, item.accent && { color: item.over ? '#FF453A' : C.accent, fontSize: 22 }]}>{item.val}</Text>
                      <Text style={nutStyles.formulaLbl}>{item.lbl}</Text>
                    </View>
              )}
            </View>
            {(() => {
              const pct = goal > 0 ? Math.min(consumed / goal, 1) : 0;
              const barColor = pct >= 1 ? '#FF453A' : pct >= 0.85 ? '#FF9F0A' : '#30D158';
              return (
                <View style={{ marginTop: 14 }}>
                  <View style={{ height: 5, backgroundColor: C.s3, borderRadius: 3, overflow: 'hidden' }}>
                    <View style={{ height: '100%', width: `${pct * 100}%`, backgroundColor: barColor, borderRadius: 3 }} />
                  </View>
                  <Text style={{ fontSize: 10, color: C.t3, marginTop: 5, textAlign: 'right' }}>
                    {Math.round(pct * 100)}% of daily goal
                  </Text>
                </View>
              );
            })()}
          </View></TouchableOpacity>
          <View style={{ height: 12 }} />
          {meals.map(meal => {
            const mealCal = meal.items.reduce((s, i) => s + i.cal, 0);
            return (
              <View key={meal.name} style={[nutStyles.card, { backgroundColor: C.surface }]}>
                <View style={{ flexDirection: 'row', overflow: 'hidden', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
                  <View style={{ width: 4, backgroundColor: C.accent }} />
                  <TouchableOpacity
                    style={[nutStyles.mealHeader, { flex: 1 }]}
                    activeOpacity={logEditMode ? 1 : 0.7}
                    disabled={logEditMode}
                    onPress={() => setMealDetail(meal)}
                  >
                    <Text style={nutStyles.mealName}>{meal.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {!logEditMode && mealCal > 0 && (
                        <TouchableOpacity onPress={() => setSharingMeal(meal)}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.s2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 }}>
                          <Ionicons name="camera-outline" size={13} color={C.accent} />
                          <Text style={{ fontSize: 11, fontWeight: '700', color: C.accent }}>Share</Text>
                        </TouchableOpacity>
                      )}
                      <Text style={nutStyles.mealCal}>{mealCal} cal</Text>
                      {!logEditMode && <Ionicons name="chevron-forward" size={14} color={C.t3} />}
                    </View>
                  </TouchableOpacity>
                </View>
                <View style={nutStyles.sep} />
                {meal.items.map((item, idx) => (
                  <View key={`${item.name}-${idx}`}>
                    <SwipeableRow onDelete={() => deleteFoodDirect(meal.name, idx)} disabled={logEditMode}>
                      <TouchableOpacity
                        style={[nutStyles.foodRow, logEditMode && selectedLogItems[selectionKey(meal.name, idx)] && nutStyles.foodRowSelected]}
                        activeOpacity={0.7}
                        onLongPress={() => enterLogEditMode(meal.name, idx)}
                        delayLongPress={280}
                        onPress={() => logEditMode ? toggleLogSelection(meal.name, idx) : setEditingItem({ mealName: meal.name, idx, item })}
                      >
                        {logEditMode && (
                          <View style={[nutStyles.selectCircle, selectedLogItems[selectionKey(meal.name, idx)] && nutStyles.selectCircleActive]}>
                            {selectedLogItems[selectionKey(meal.name, idx)] && <Ionicons name="checkmark" size={13} color="#fff" />}
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={nutStyles.foodName}>{item.name}</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
                            {item.servings != null && item.servings !== 1 && (
                              <Text style={{ fontSize: 10, color: C.t3 }}>{item.servings}×</Text>
                            )}
                            <Text style={{ fontSize: 11, color: C.t3 }}>{item.cal} cal</Text>
                            {[
                              { label: `${item.p}p`, color: '#FFB340' },
                              { label: `${item.c}c`, color: '#30D158' },
                              { label: `${item.f}f`, color: '#BF5AF2' },
                            ].map(chip => (
                              <View key={chip.label} style={{ backgroundColor: chip.color + '22', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 }}>
                                <Text style={{ fontSize: 10, fontWeight: '700', color: chip.color }}>{chip.label}</Text>
                              </View>
                            ))}
                          </View>
                        </View>
                        {!logEditMode && <Ionicons name="chevron-forward" size={14} color={C.t3} />}
                      </TouchableOpacity>
                    </SwipeableRow>
                    <View style={nutStyles.sep} />
                  </View>
                ))}
                {!logEditMode && (
                  <View style={[nutStyles.addRow, { paddingHorizontal: 0, paddingVertical: 0 }]}>
                    <TouchableOpacity style={{ flex: 1, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'flex-start' }} activeOpacity={0.6} onPress={() => setAddingTo(meal.name)}>
                      <Text style={nutStyles.addText}>ADD FOOD</Text>
                    </TouchableOpacity>
                    <View style={{ width: 0.5, height: '100%', backgroundColor: C.border }} />
                    <TouchableOpacity style={{ width: 50, alignItems: 'center', justifyContent: 'center', paddingVertical: 14 }} activeOpacity={0.6}
                      onPress={() => { setScanTarget(meal.name); setTimeout(() => setBarcodeScanning(true), 80); }}>
                      <Ionicons name="barcode-outline" size={20} color={C.accent} />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}

          {totalLoggedItems === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: 28, paddingHorizontal: 32 }}>
              <Ionicons name="nutrition-outline" size={36} color={C.t3} style={{ marginBottom: 10, opacity: 0.5 }} />
              <Text style={{ fontSize: 15, fontWeight: '700', color: C.t2, marginBottom: 6 }}>Nothing logged yet</Text>
              <Text style={{ fontSize: 13, color: C.t3, textAlign: 'center', lineHeight: 19 }}>Tap ADD FOOD on any meal above to start tracking your nutrition.</Text>
            </View>
          )}

        </ScrollView>

        {/* ── NUTRIENTS ── */}
        <ScrollView ref={nutriScrollRef} style={{ width: screenW }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          <View style={[nutStyles.card, { backgroundColor: C.surface, marginTop: 12 }]}>
            <View style={{ flexDirection: 'row', overflow: 'hidden', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
              <View style={{ width: 4, backgroundColor: C.accent }} />
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: C.t1 }}>Nutrients</Text>
                <View style={{ flexDirection: 'row' }}>
                  {['Total', 'Goal', 'Left'].map(lbl => (
                    <Text key={lbl} style={{ fontSize: 11, color: C.t3, width: 50, textAlign: 'right' }}>{lbl}</Text>
                  ))}
                </View>
              </View>
            </View>
            <View style={nutStyles.sep} />
            {NUTRIENTS.map(n => {
              const left    = n.goal != null ? n.goal - n.total : null;
              const isOver  = left !== null && left < 0;
              const pct     = n.goal ? Math.min(n.total / n.goal, 1) : 0;
              const leftTxt = left === null ? '–' : isOver ? `+${Math.abs(left)}` : String(left);
              const barColor = pct >= 1 ? '#FF453A' : pct >= 0.85 ? '#FF9F0A' : (n.color || C.accent);
              return (
                <View key={n.name}>
                  <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
                    {n.color && <View style={{ width: 3, backgroundColor: n.color + '66' }} />}
                    <View style={[nutStyles.nutriRow, { flex: 1, paddingLeft: n.color ? 12 : 16 }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={nutStyles.nutriName}>{n.name}</Text>
                        {n.color && (
                          <View style={nutStyles.nutriBarTrack}>
                            <View style={[nutStyles.nutriBarFill, { width: `${pct * 100}%`, backgroundColor: barColor }]} />
                          </View>
                        )}
                      </View>
                      <Text style={[nutStyles.nutriVal, { width: 50 }]}>{n.total}{n.unit}</Text>
                      <Text style={[nutStyles.nutriVal, { width: 50 }]}>{n.goal != null ? `${n.goal}${n.unit}` : '–'}</Text>
                      <Text style={[nutStyles.nutriVal, { width: 50, color: isOver ? '#FF453A' : C.t2 }]}>{leftTxt}{n.unit}</Text>
                    </View>
                  </View>
                  <View style={nutStyles.sep} />
                </View>
              );
            })}
          </View>
          {totalLoggedItems === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: 28, paddingHorizontal: 32 }}>
              <Ionicons name="flask-outline" size={36} color={C.t3} style={{ marginBottom: 10, opacity: 0.5 }} />
              <Text style={{ fontSize: 15, fontWeight: '700', color: C.t2, marginBottom: 6 }}>No data yet</Text>
              <Text style={{ fontSize: 13, color: C.t3, textAlign: 'center', lineHeight: 19 }}>Log food in the Calories tab to see your nutrient breakdown.</Text>
            </View>
          )}
        </ScrollView>

        {/* ── MACROS ── */}
        <ScrollView ref={macroScrollRef} style={{ width: screenW }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          <View style={[nutStyles.card, { backgroundColor: C.surface, marginTop: 12 }]}>
            <View style={nutStyles.ringsRow}>
              {[
                { name: 'Protein', color: '#FFB340', total: totalP, goal: goals.protein },
                { name: 'Carbs',   color: '#30D158', total: totalC, goal: goals.carbs   },
                { name: 'Fat',     color: '#BF5AF2', total: totalF, goal: goals.fat     },
              ].map(m => {
                const p = m.goal > 0 ? Math.min(m.total / m.goal, 1) : 0;
                return (
                  <View key={m.name} style={nutStyles.ringWrap}>
                    <View style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }}>
                      <AnimatedRingProgress size={96} stroke={8} progress={p} color={m.color} />
                      <View style={[nutStyles.ringCenter, { position: 'absolute' }]}>
                        <Text style={[nutStyles.ringVal, { color: m.color }]}>{m.total}g</Text>
                        <Text style={nutStyles.ringGoal}>of {m.goal}g</Text>
                      </View>
                    </View>
                    <Text style={nutStyles.ringName}>{m.name}</Text>
                    <Text style={[nutStyles.ringLeft, m.total > m.goal && { color: '#FF453A' }]}>
                      {m.total > m.goal ? `${m.total - m.goal}g over` : `${m.goal - m.total}g left`}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
          {/* Calorie breakdown */}
          <View style={[nutStyles.card, { backgroundColor: C.surface }]}>
            <View style={{ flexDirection: 'row', overflow: 'hidden', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
              <View style={{ width: 4, backgroundColor: C.accent }} />
              <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: C.t1 }}>Calorie Breakdown</Text>
                <Text style={{ fontSize: 13, color: C.t3 }}>{consumed} kcal</Text>
              </View>
            </View>
            <View style={nutStyles.sep} />
            {(() => {
              const macroCal = totalP * 4 + totalC * 4 + totalF * 9;
              const other    = consumed - macroCal;
              const rows = [
                { name: 'Protein',       cal: totalP * 4, color: '#FFB340' },
                { name: 'Carbohydrates', cal: totalC * 4, color: '#30D158' },
                { name: 'Fat',           cal: totalF * 9, color: '#BF5AF2' },
              ];
              if (other > 0) rows.push({ name: 'Other', cal: other, color: C.t3 });
              return rows.map(m => (
                <View key={m.name}>
                  <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
                    <View style={{ width: 3, backgroundColor: m.color + '66' }} />
                    <View style={nutStyles.calBreakRow}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={[nutStyles.dot, { backgroundColor: m.color }]} />
                        <Text style={nutStyles.calBreakLbl}>{m.name}</Text>
                      </View>
                      <Text style={[nutStyles.calBreakVal, { color: m.color }]}>{m.cal} kcal</Text>
                    </View>
                  </View>
                  <View style={nutStyles.sep} />
                </View>
              ));
            })()}
          </View>
          {totalLoggedItems === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: 28, paddingHorizontal: 32 }}>
              <Ionicons name="pie-chart-outline" size={36} color={C.t3} style={{ marginBottom: 10, opacity: 0.5 }} />
              <Text style={{ fontSize: 15, fontWeight: '700', color: C.t2, marginBottom: 6 }}>No macros yet</Text>
              <Text style={{ fontSize: 13, color: C.t3, textAlign: 'center', lineHeight: 19 }}>Log food in the Calories tab to see your macro breakdown.</Text>
            </View>
          )}
        </ScrollView>

      </ScrollView>

      {logEditMode && (
        <View style={nutStyles.bulkBar}>
          {pendingDelete ? (
            <>
              <Text style={nutStyles.bulkCount}>Delete {selectedCount} item{selectedCount === 1 ? '' : 's'}?</Text>
              <View style={nutStyles.bulkActions}>
                <TouchableOpacity style={nutStyles.bulkCancelBtn} onPress={() => setPendingDelete(false)} activeOpacity={0.8}>
                  <Text style={nutStyles.bulkCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={nutStyles.bulkDeleteBtn} onPress={confirmDeleteLogs} activeOpacity={0.8}>
                  <Ionicons name="trash-outline" size={17} color="#fff" />
                  <Text style={nutStyles.bulkDeleteText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={nutStyles.bulkCount}>{selectedCount} selected</Text>
              <TouchableOpacity
                style={[nutStyles.bulkDeleteBtn, selectedCount === 0 && { opacity: 0.45 }]}
                onPress={() => setPendingDelete(true)}
                disabled={selectedCount === 0}
                activeOpacity={0.8}
              >
                <Ionicons name="trash-outline" size={17} color="#fff" />
                <Text style={nutStyles.bulkDeleteText}>Delete</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      <AddFoodModal
        visible={addingTo !== null}
        meal={addingTo}
        onClose={() => setAddingTo(null)}
        onAddFood={addFood}
        onQuickAdd={quickAddFood}
        customFoods={customFoods}
        onCreateFood={addCustomFood}
        onEditFood={editCustomFood}
        onDeleteFood={deleteCustomFood}
        onOpenLabel={(barcode) => { const m = addingTo; setScanTarget(m); setScanBarcode(barcode || null); setAddingTo(null); setTimeout(() => setLabelScanning(true), 350); }}
        onOpenMealScan={() => { const m = addingTo; setScanTarget(m); setAddingTo(null); setTimeout(() => setMealScanning(true), 350); }}
        onOpenBarcode={() => { const m = addingTo; setScanTarget(m); setAddingTo(null); setTimeout(() => setBarcodeScanning(true), 500); }}
      />
      <BarcodeScannerModal
        visible={barcodeScanning}
        meal={scanTarget}
        onClose={() => { setBarcodeScanning(false); setScanTarget(null); }}
        onAddFood={addFood}
        onScanLabel={(barcode) => { setBarcodeScanning(false); setScanBarcode(barcode || null); setLabelScanning(true); }}
      />
      <LabelScannerModal
        visible={labelScanning}
        meal={scanTarget}
        onClose={() => { setLabelScanning(false); setScanBarcode(null); setScanTarget(null); }}
        onAddFood={addFood}
        pendingBarcode={scanBarcode}
      />
      <MealScanModal
        visible={mealScanning}
        meal={scanTarget}
        onClose={() => { setMealScanning(false); setScanTarget(null); }}
        onAddAllFoods={addAllFoods}
      />
      {/* ── TOAST ── */}
        <Animated.View
          pointerEvents="box-none"
          style={[{ position:'absolute', bottom: insets.bottom + 16, alignSelf:'center', zIndex:99,
            flexDirection:'row', alignItems:'center', gap:10,
            backgroundColor:'rgba(44,44,46,0.97)', borderRadius:14,
            paddingVertical:11, paddingHorizontal:18,
            shadowColor:'#000', shadowOpacity:0.35, shadowRadius:12, shadowOffset:{width:0,height:4} },
            { opacity: toastOpacity, transform: [{ translateY: toastY }] }]}>
          <Text style={{ color:'#fff', fontSize:14, fontWeight:'500' }}>{toastMsg}</Text>
          {undoData && (
            <TouchableOpacity
              onPress={() => {
                clearTimeout(toastTimer.current);
                const { mealName, idx, item } = undoData;
                saveMeals(m => m.map(ml => {
                  if (ml.name !== mealName) return ml;
                  const items = [...ml.items];
                  items.splice(idx, 0, item);
                  return { ...ml, items };
                }));
                setUndoData(null);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                Animated.parallel([
                  Animated.timing(toastOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
                  Animated.timing(toastY, { toValue: 8, duration: 200, useNativeDriver: true }),
                ]).start();
              }}
              hitSlop={8}
            >
              <Text style={{ color:'#0A84FF', fontSize:14, fontWeight:'700' }}>Undo</Text>
            </TouchableOpacity>
          )}
        </Animated.View>

      {mealDetail && <MealDetailModal meal={mealDetail} onClose={() => setMealDetail(null)} goals={goals} />}
      {sharingMeal && <NutritionShareModal meal={sharingMeal} onClose={() => setSharingMeal(null)} />}
      {editingItem && (
        <EditFoodSheet
          item={editingItem.item}
          onSave={(updated) => updateFood(editingItem.mealName, editingItem.idx, updated)}
          onDelete={() => { deleteFoodDirect(editingItem.mealName, editingItem.idx); setEditingItem(null); }}
          onClose={() => setEditingItem(null)}
        />
      )}

      {/* ── DATE PICKER ── */}
      <Modal visible={showDatePicker} transparent animationType="none" onRequestClose={closeDatePicker}>
        <View style={dpStyles.modalWrap}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeDatePicker}>
            <Animated.View style={[StyleSheet.absoluteFill, dpStyles.backdrop, { opacity: datePickerAnim }]} />
          </TouchableOpacity>
          <Animated.View style={[dpStyles.sheet, datePickerSheetStyle]}>
            <View style={dpStyles.handle} {...dpSwipePan.panHandlers} />
            <View style={dpStyles.pickerHeader}>
              <TouchableOpacity hitSlop={14} onPress={closeDatePicker}>
                <Ionicons name="close" size={25} color={C.t1} />
              </TouchableOpacity>
              <Text style={dpStyles.title}>Day Ending On:</Text>
              <TouchableOpacity hitSlop={14} onPress={confirmDatePicker}>
                <Ionicons name="checkmark" size={29} color={C.t1} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={dpStyles.todayLink} activeOpacity={0.75} onPress={jumpPickerToToday}>
              <Text style={dpStyles.todayLinkText}>Today</Text>
            </TouchableOpacity>
            <View style={[dpStyles.wheelWrap, { height: WHEEL_VISIBLE_H }]}>
              <View pointerEvents="none" style={dpStyles.wheelSelection} />
              <FlatList
                key={`day-${pickerKey}-${pickerDays.length}`}
                ref={dayWheelRef}
                style={dpStyles.wheelDayCol}
                data={pickerDays}
                keyExtractor={(item) => `day-${item}`}
                renderItem={({ item }) => (
                  <View style={dpStyles.wheelItem}>
                    <Text style={[dpStyles.wheelText, item === pickerDay && dpStyles.wheelTextActive]}>{item}</Text>
                  </View>
                )}
                initialScrollIndex={Math.max(0, pickerDay - 1)}
                getItemLayout={(_, index) => ({ length: WHEEL_ITEM_H, offset: WHEEL_ITEM_H * index, index })}
                snapToInterval={WHEEL_ITEM_H}
                decelerationRate="fast"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingVertical: WHEEL_ITEM_H * 2 }}
                onMomentumScrollEnd={(event) => onWheelMomentumEnd(event, pickerDays, setPickerDay)}
                onScrollToIndexFailed={({ index }) => setTimeout(() => dayWheelRef.current?.scrollToIndex({ index, animated: false }), 0)}
              />
              <FlatList
                key={`month-${pickerKey}`}
                ref={monthWheelRef}
                style={dpStyles.wheelMonthCol}
                data={MONTH_NAMES}
                keyExtractor={(item) => item}
                renderItem={({ item, index }) => (
                  <View style={dpStyles.wheelItem}>
                    <Text style={[dpStyles.wheelText, index === pickerMonth && dpStyles.wheelTextActive]}>{item}</Text>
                  </View>
                )}
                initialScrollIndex={pickerMonth}
                getItemLayout={(_, index) => ({ length: WHEEL_ITEM_H, offset: WHEEL_ITEM_H * index, index })}
                snapToInterval={WHEEL_ITEM_H}
                decelerationRate="fast"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingVertical: WHEEL_ITEM_H * 2 }}
                onMomentumScrollEnd={(event) => onWheelMomentumEnd(event, MONTH_NAMES.map((_, i) => i), (value) => { setPickerMonth(value); clampPickerDay(pickerYear, value); })}
                onScrollToIndexFailed={({ index }) => setTimeout(() => monthWheelRef.current?.scrollToIndex({ index, animated: false }), 0)}
              />
              <FlatList
                key={`year-${pickerKey}`}
                ref={yearWheelRef}
                style={dpStyles.wheelYearCol}
                data={pickerYears}
                keyExtractor={(item) => `year-${item}`}
                renderItem={({ item }) => (
                  <View style={dpStyles.wheelItem}>
                    <Text style={[dpStyles.wheelText, item === pickerYear && dpStyles.wheelTextActive]}>{item}</Text>
                  </View>
                )}
                initialScrollIndex={Math.max(0, pickerYears.indexOf(pickerYear))}
                getItemLayout={(_, index) => ({ length: WHEEL_ITEM_H, offset: WHEEL_ITEM_H * index, index })}
                snapToInterval={WHEEL_ITEM_H}
                decelerationRate="fast"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingVertical: WHEEL_ITEM_H * 2 }}
                onMomentumScrollEnd={(event) => onWheelMomentumEnd(event, pickerYears, (value) => { setPickerYear(value); clampPickerDay(value, pickerMonth); })}
                onScrollToIndexFailed={({ index }) => setTimeout(() => yearWheelRef.current?.scrollToIndex({ index, animated: false }), 0)}
              />
            </View>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

function ProgressLineChart({ data, width, color, height = 190, unit = '', chartId = 'lc' }) {
  if (!data || data.length < 2) return null;
  const vals = data.map(d => d.value);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = maxV - minV || 1;
  const padL = 46, padR = 16, padT = 32, padB = 28;
  const cW = width - padL - padR;
  const cH = height - padT - padB;
  const toX = i => padL + (i / (data.length - 1)) * cW;
  const toY = v => padT + cH - ((v - minV) / range) * cH;
  const pts = data.map((d, i) => ({ x: toX(i), y: toY(d.value), value: d.value, label: d.label || '' }));

  // Catmull-Rom → cubic Bezier for smooth curves
  const smoothLine = pts.map((p, i) => {
    if (i === 0) return `M ${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    const p0 = pts[Math.max(i - 2, 0)];
    const p1 = pts[i - 1];
    const p2 = p;
    const p3 = pts[Math.min(i + 1, pts.length - 1)];
    const cp1x = (p1.x + (p2.x - p0.x) / 6).toFixed(1);
    const cp1y = (p1.y + (p2.y - p0.y) / 6).toFixed(1);
    const cp2x = (p2.x - (p3.x - p1.x) / 6).toFixed(1);
    const cp2y = (p2.y - (p3.y - p1.y) / 6).toFixed(1);
    return `C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }).join(' ');

  const fillPath = smoothLine
    + ` L ${pts[pts.length-1].x.toFixed(1)},${(padT+cH).toFixed(1)}`
    + ` L ${pts[0].x.toFixed(1)},${(padT+cH).toFixed(1)} Z`;

  const gradId = `grad_${chartId}`;
  const lc = 'rgba(255,255,255,0.28)';
  const gridTs = [0, 0.5, 1];
  const lastPt = pts[pts.length - 1];
  const n = data.length;
  const xIdxs = n <= 5 ? pts.map((_, i) => i)
    : n <= 10 ? [0, Math.floor(n/3), Math.floor(2*n/3), n-1]
    : [0, Math.floor(n/4), Math.floor(n/2), Math.floor(3*n/4), n-1];

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <Stop offset="100%" stopColor={color} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      {/* Grid lines + Y labels */}
      {gridTs.map((t, i) => {
        const y = padT + cH * (1 - t);
        const v = minV + range * t;
        return (
          <React.Fragment key={i}>
            <Path d={`M ${padL},${y.toFixed(1)} L ${(padL+cW).toFixed(1)},${y.toFixed(1)}`}
              stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
            <SvgText x={padL - 6} y={y + 4} fontSize={9} fill={lc} textAnchor="end">
              {v.toFixed(0)}
            </SvgText>
          </React.Fragment>
        );
      })}
      {/* Gradient fill */}
      <Path d={fillPath} fill={`url(#${gradId})`} />
      {/* Smooth line */}
      <Path d={smoothLine} fill="none" stroke={color} strokeWidth={2.5}
        strokeLinecap="round" strokeLinejoin="round" />
      {/* Small dots */}
      {pts.slice(0, -1).map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={2.5} fill={color} opacity={0.45} />
      ))}
      {/* Last point highlight: outer glow ring + filled dot + white center */}
      <Circle cx={lastPt.x} cy={lastPt.y} r={9} fill={color} opacity={0.15} />
      <Circle cx={lastPt.x} cy={lastPt.y} r={5.5} fill={color} />
      <Circle cx={lastPt.x} cy={lastPt.y} r={2.2} fill="#fff" />
      {/* Value callout */}
      <SvgText x={lastPt.x} y={lastPt.y - 16} fontSize={12} fill={color}
        textAnchor="middle" fontWeight="700">
        {lastPt.value.toFixed(1)}{unit}
      </SvgText>
      {/* X axis labels */}
      {xIdxs.map(i => (
        <SvgText key={i} x={pts[i].x} y={padT + cH + padB - 2} fontSize={9} fill={lc}
          textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
          {pts[i].label}
        </SvgText>
      ))}
    </Svg>
  );
}

function VolumeBarChart({ data, width, color, height = 130 }) {
  const maxVol = Math.max(...data.map(d => d.vol), 1);
  const padL = 8, padR = 8, padT = 10, padB = 22;
  const cW = width - padL - padR;
  const cH = height - padT - padB;
  const gap = cW / data.length;
  const barW = gap * 0.55;
  const isLight = color.startsWith('#');
  return (
    <Svg width={width} height={height}>
      {data.map((d, i) => {
        const barH = d.vol > 0 ? Math.max((d.vol / maxVol) * cH, 3) : 2;
        const x = padL + gap * i + (gap - barW) / 2;
        const y = padT + cH - barH;
        const isLast = i === data.length - 1;
        const opacity = isLast ? 1 : 0.2 + (i / (data.length - 1)) * 0.55;
        const showLabel = i === 0 || i === data.length - 1 || i % 3 === 0;
        return (
          <React.Fragment key={i}>
            <Rect x={x.toFixed(1)} y={y.toFixed(1)} width={barW.toFixed(1)}
              height={barH.toFixed(1)} rx={3} fill={color} opacity={opacity} />
            {showLabel && (
              <SvgText x={(x + barW / 2).toFixed(1)} y={padT + cH + padB - 2}
                fontSize={8} fill="rgba(255,255,255,0.28)" textAnchor="middle">
                {d.label}
              </SvgText>
            )}
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

function ProgressScreen() {
  const insets = useSafeAreaInsets();
  const C = useContext(ThemeContext);
  const styles = mkStyles(C);
  const pgStyles = mkPgStyles(C);
  const screenW  = Dimensions.get('window').width;

  const [pgTab,        setPgTab]        = useState('Strength');
  const [wkHistory,    setWkHistory]    = useState([]);
  const [selectedEx,   setSelectedEx]   = useState(null);
  const [detailWk,     setDetailWk]     = useState(null);

  const pgScrollRef = useRef(null);
  const PG_TABS = ['Strength', 'Workouts'];

  const handlePgTabPress = (t) => {
    const idx = PG_TABS.indexOf(t);
    setPgTab(t);
    pgScrollRef.current?.scrollTo({ x: idx * screenW, animated: true });
  };
  const handlePgScrollEnd = (e) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / screenW);
    setPgTab(PG_TABS[idx]);
  };

  useFocusEffect(useCallback(() => {
    AsyncStorage.getItem(WORKOUTS_KEY).then(raw => setWkHistory(parseStoredJson(raw, [])));
  }, []));

  // All distinct strength exercise names from history
  const allExNames = useMemo(() => {
    const names = new Set();
    for (const w of wkHistory) {
      for (const ex of (w.exercises || [])) {
        if (ex.name && !['Running', 'Cycling', 'Walking', 'Rowing', 'Jump Rope', 'Swimming', 'Elliptical', 'Stair Climber', 'HIIT', 'Other Cardio'].includes(ex.name)) {
          names.add(ex.name);
        }
      }
    }
    return [...names].sort();
  }, [wkHistory]);

  // Auto-select preferred exercise
  useEffect(() => {
    if (allExNames.length > 0 && !selectedEx) {
      const pref = ['Bench Press', 'Squat', 'Deadlift', 'Overhead Press'].find(n => allExNames.includes(n));
      setSelectedEx(pref || allExNames[0]);
    }
  }, [allExNames]);

  // e1RM history for selected exercise (Epley formula)
  const e1RMData = useMemo(() => {
    if (!selectedEx) return [];
    const pts = [];
    const sorted = [...wkHistory].reverse(); // oldest first
    for (const w of sorted) {
      for (const ex of (w.exercises || [])) {
        if (ex.name !== selectedEx) continue;
        let best = 0;
        for (const s of (ex.sets || [])) {
          if (s.type === 'warmup') continue;
          const wt = parseFloat(s.weight) || 0;
          const reps = parseInt(s.reps) || 0;
          if (wt > 0 && reps > 0 && reps <= 12) {
            const e1 = wt * (1 + reps / 30);
            if (e1 > best) best = e1;
          } else if (wt > 0 && reps === 1) {
            if (wt > best) best = wt;
          }
        }
        if (best > 0) {
          const d = (w.date || '').split('T')[0];
          pts.push({ value: Math.round(best * 10) / 10, label: d.slice(5) });
        }
      }
    }
    return pts;
  }, [selectedEx, wkHistory]);

  // All-exercise PRs (best working set weight)
  const allPRs = useMemo(() => {
    const prs = {};
    for (const w of wkHistory) {
      for (const ex of (w.exercises || [])) {
        if (!ex.name) continue;
        for (const s of (ex.sets || [])) {
          if (s.type === 'warmup') continue;
          const wt = parseFloat(s.weight) || 0;
          if (wt > 0 && (!prs[ex.name] || wt > prs[ex.name].weight)) {
            prs[ex.name] = { weight: wt, date: (w.date || '').split('T')[0] };
          }
        }
      }
    }
    return Object.entries(prs)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [wkHistory]);

  // Last 12 weeks of volume for bar chart
  const weeklyVolume = useMemo(() => {
    const now = new Date();
    const dow = now.getDay(); // 0=Sun
    return Array.from({ length: 12 }, (_, i) => {
      const start = new Date(now);
      start.setDate(now.getDate() - ((dow + 6) % 7) - i * 7);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(start.getDate() + 7);
      const vol = wkHistory
        .filter(w => { const d = new Date(w.date); return d >= start && d < end; })
        .reduce((s, w) => s + (w.volume || 0), 0);
      const m = start.getMonth() + 1, d2 = start.getDate();
      return { vol, label: `${m}/${d2}` };
    }).reverse();
  }, [wkHistory]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: C.bg }]}>
      <StatusBar barStyle={C.statusBar} />

      <View style={pgStyles.header}>
        <Text style={pgStyles.title}>Progress</Text>
      </View>

      <View style={[pgStyles.tabBar, { backgroundColor: C.surface }]}>
        {PG_TABS.map(t => (
          <TouchableOpacity key={t} style={pgStyles.tab} onPress={() => handlePgTabPress(t)} activeOpacity={0.7}>
            <Text style={[pgStyles.tabText, pgTab === t && pgStyles.tabActive]}>{t}</Text>
            {pgTab === t && <View style={pgStyles.tabUnderline} />}
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView ref={pgScrollRef} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handlePgScrollEnd} style={{ flex: 1 }}>

        {/* ── STRENGTH ── */}
        <ScrollView style={{ width: screenW }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>

          {/* Exercise picker */}
          {allExNames.length > 0 ? (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 8 }}>
                {allExNames.map(name => {
                  const active = selectedEx === name;
                  return (
                    <TouchableOpacity key={name} onPress={() => setSelectedEx(name)} activeOpacity={0.7}
                      style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                        backgroundColor: active ? C.accent : C.surface,
                        borderWidth: active ? 0 : 1, borderColor: C.border }}>
                      <Text style={{ fontSize: 13, fontWeight: active ? '700' : '500',
                        color: active ? '#fff' : C.t2 }}>{name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* e1RM Chart */}
              <View style={[pgStyles.chartCard, { backgroundColor: C.surface, paddingBottom: 8 }]}>
                <View style={pgStyles.chartHeader}>
                  <View>
                    <Text style={pgStyles.chartTitle}>{selectedEx}</Text>
                    <Text style={{ fontSize: 11, color: C.t3, marginTop: 2 }}>Estimated 1 Rep Max</Text>
                  </View>
                  {e1RMData.length > 0 && (
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={pgStyles.chartCurrent}>{e1RMData[e1RMData.length-1].value} kg</Text>
                      {e1RMData.length >= 2 && (() => {
                        const diff = Math.round((e1RMData[e1RMData.length-1].value - e1RMData[0].value) * 10) / 10;
                        return <Text style={{ fontSize: 12, color: diff >= 0 ? '#30D158' : '#FF453A', marginTop: 2 }}>
                          {diff >= 0 ? '+' : ''}{diff} kg
                        </Text>;
                      })()}
                    </View>
                  )}
                </View>
                {e1RMData.length >= 2 ? (
                  <ProgressLineChart data={e1RMData} width={screenW - 64} color={C.accent} height={190} unit=" kg" chartId="e1rm" />
                ) : (
                  <Text style={{ color: C.t3, fontSize: 13, marginTop: 16, marginBottom: 8 }}>
                    {e1RMData.length === 0 ? 'Log working sets to track strength' : 'Log more sessions to see trend'}
                  </Text>
                )}
              </View>

              {/* All PRs */}
              <Text style={pgStyles.sectionTitle}>Personal Records</Text>
              {allPRs.length > 0 ? (
                <View style={[pgStyles.card, { backgroundColor: C.surface }]}>
                  {allPRs.map((pr, i) => (
                    <TouchableOpacity key={pr.name} onPress={() => setSelectedEx(pr.name)} activeOpacity={0.7}
                      style={[pgStyles.row, i < allPRs.length - 1 && pgStyles.rowBorder,
                        selectedEx === pr.name && { backgroundColor: C.accent + '10' }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={pgStyles.rowLabel}>{pr.name}</Text>
                        <Text style={{ fontSize: 11, color: C.t3, marginTop: 1 }}>{pr.date}</Text>
                      </View>
                      <Text style={[pgStyles.rowVal, { color: C.accent }]}>{pr.weight} kg</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <Text style={{ color: C.t3, fontSize: 13, textAlign: 'center', marginTop: 8 }}>
                  Complete a workout to see your records
                </Text>
              )}
            </>
          ) : (
            <View style={{ flex: 1, alignItems: 'center', paddingTop: 60, gap: 8 }}>
              <Ionicons name="barbell-outline" size={44} color={C.t3} />
              <Text style={{ fontSize: 16, fontWeight: '700', color: C.t2 }}>No workouts yet</Text>
              <Text style={{ fontSize: 14, color: C.t3, textAlign: 'center', paddingHorizontal: 32 }}>
                Log your first workout to start tracking strength progress
              </Text>
            </View>
          )}
        </ScrollView>

        {/* ── WORKOUTS ── */}
        <ScrollView style={{ width: screenW }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
          {(() => {
            const total    = wkHistory.length;
            const totalSec = wkHistory.reduce((s, w) => s + (w.duration || 0), 0);
            const totalVol = wkHistory.reduce((s, w) => s + (w.volume   || 0), 0);
            const first    = wkHistory.length ? new Date(wkHistory[wkHistory.length - 1].date) : new Date();
            const weeks    = Math.max(1, Math.ceil((Date.now() - first.getTime()) / (7 * 86400000)));
            const totalH   = Math.floor(totalSec / 3600);
            const totalM   = Math.floor((totalSec % 3600) / 60);
            const timeStr  = totalH > 0 ? `${totalH}h ${totalM}m` : `${totalM}m`;
            const totalVolK = totalVol >= 1000 ? `${(totalVol / 1000).toFixed(1)}k` : String(totalVol);
            const hasVol = weeklyVolume.some(w => w.vol > 0);
            return (
              <>
                {/* Stats grid */}
                <View style={pgStyles.statsGrid}>
                  {[
                    { val: String(total),              lbl: 'Workouts'   },
                    { val: timeStr,                    lbl: 'Total Time' },
                    { val: `${totalVolK} kg`,          lbl: 'Volume'     },
                    { val: (total / weeks).toFixed(1), lbl: 'Avg / Week' },
                  ].map(s => (
                    <View key={s.lbl} style={[pgStyles.statBox, { backgroundColor: C.surface }]}>
                      <Text style={pgStyles.statVal}>{s.val}</Text>
                      <Text style={pgStyles.statLbl}>{s.lbl}</Text>
                    </View>
                  ))}
                </View>

                {/* Weekly volume bar chart */}
                {hasVol && (
                  <View style={[pgStyles.chartCard, { backgroundColor: C.surface, paddingBottom: 4 }]}>
                    <View style={[pgStyles.chartHeader, { marginBottom: 12 }]}>
                      <View>
                        <Text style={pgStyles.chartTitle}>Weekly Volume</Text>
                        <Text style={{ fontSize: 11, color: C.t3, marginTop: 2 }}>Last 12 weeks · kg lifted</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={pgStyles.chartCurrent}>
                          {weeklyVolume[weeklyVolume.length-1].vol >= 1000
                            ? `${(weeklyVolume[weeklyVolume.length-1].vol / 1000).toFixed(1)}k`
                            : weeklyVolume[weeklyVolume.length-1].vol} kg
                        </Text>
                        <Text style={{ fontSize: 11, color: C.t3, marginTop: 2 }}>this week</Text>
                      </View>
                    </View>
                    <VolumeBarChart data={weeklyVolume} width={screenW - 64} color={C.accent} height={130} />
                  </View>
                )}

                <Text style={pgStyles.sectionTitle}>History</Text>
                {wkHistory.length === 0 ? (
                  <View style={{ paddingTop: 32, alignItems: 'center' }}>
                    <Text style={{ color: C.t3, fontSize: 14 }}>No workouts logged yet</Text>
                  </View>
                ) : wkHistory.slice(0, 25).map(w => (
                  <TouchableOpacity key={w.id} style={[pgStyles.card, { marginBottom: 10, backgroundColor: C.surface }]}
                    onPress={() => setDetailWk(w)} activeOpacity={0.75}>
                    <View style={pgStyles.row}>
                      <View style={{ flex: 1 }}>
                        <Text style={pgStyles.rowLabel}>{w.name}</Text>
                        <Text style={{ fontSize: 12, color: C.t3, marginTop: 2 }}>
                          {w.exercises?.slice(0,3).map(e=>e.name).join(' · ')}{w.exercises?.length>3?` +${w.exercises.length-3}`:''}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ fontSize: 13, color: C.t3 }}>{fmtWkDate(w.date)}</Text>
                        <Text style={{ fontSize: 12, color: C.accent, fontWeight: '600', marginTop: 2 }}>
                          {fmtDuration(w.duration)} · {w.volume?.toLocaleString()} kg
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            );
          })()}
        </ScrollView>

      </ScrollView>

      <Modal visible={!!detailWk} animationType="slide" presentationStyle="pageSheet"
        onRequestClose={() => setDetailWk(null)}>
        {detailWk && (
          <View style={{ flex: 1, backgroundColor: C.bg }}>
            <SwipeBackEdge onBack={() => setDetailWk(null)} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 20, fontWeight: '800', color: C.t1 }}>{detailWk.name}</Text>
                <Text style={{ fontSize: 13, color: C.t3, marginTop: 2 }}>
                  {fmtWkDate(detailWk.date)} · {fmtDuration(detailWk.duration)} · {detailWk.volume?.toLocaleString()} kg
                </Text>
              </View>
              <TouchableOpacity onPress={() => setDetailWk(null)} hitSlop={8}>
                <Ionicons name="close" size={24} color={C.t3} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
              {(detailWk.exercises || []).map((ex, ei) => (
                <View key={ei} style={[pgStyles.card, { marginBottom: 12, backgroundColor: C.surface }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <MuscleSprite muscle={ex.muscle} size={36} detail={false} />
                    <Text style={{ fontSize: 15, fontWeight: '700', color: C.t1, flex: 1 }}>{ex.name}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', paddingHorizontal: 4, marginBottom: 6 }}>
                    <Text style={{ width: 32, fontSize: 11, color: C.t3, fontWeight: '700' }}>#</Text>
                    <Text style={{ flex: 1, fontSize: 11, color: C.t3, fontWeight: '700' }}>WEIGHT</Text>
                    <Text style={{ width: 48, fontSize: 11, color: C.t3, fontWeight: '700', textAlign: 'right' }}>REPS</Text>
                    <Text style={{ width: 40, fontSize: 11, color: C.t3, fontWeight: '700', textAlign: 'right' }}>RPE</Text>
                  </View>
                  {(ex.sets || []).map((s, si) => (
                    <View key={si} style={{ flexDirection: 'row', paddingHorizontal: 4, paddingVertical: 4,
                      borderTopWidth: 0.5, borderTopColor: C.border,
                      opacity: s.type === 'warmup' ? 0.55 : 1 }}>
                      <Text style={{ width: 32, fontSize: 13, color: s.type === 'warmup' ? '#FF9F0A' : C.t3 }}>
                        {s.type === 'warmup' ? 'W' : si + 1}
                      </Text>
                      <Text style={{ flex: 1, fontSize: 14, color: C.t1, fontWeight: '600' }}>
                        {s.weight ? `${s.weight} kg` : '—'}
                      </Text>
                      <Text style={{ width: 48, fontSize: 14, color: C.t1, fontWeight: '600', textAlign: 'right' }}>
                        {s.reps || '—'}
                      </Text>
                      <Text style={{ width: 40, fontSize: 14, color: s.rpe ? C.accent : C.t3, fontWeight: '600', textAlign: 'right' }}>
                        {s.rpe || '—'}
                      </Text>
                    </View>
                  ))}
                  {ex.note ? (
                    <Text style={{ fontSize: 12, color: C.t3, marginTop: 8, fontStyle: 'italic' }}>{ex.note}</Text>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          </View>
        )}
      </Modal>

    </View>
  );
}

// ── WEIGHT LOG MODAL ─────────────────────────────────────
function WeightLogModal({ visible, onClose, weightLog, latestWeight, weightUnit, onSave }) {
  const C = useContext(ThemeContext);
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState('');

  useEffect(() => {
    if (visible) setInput(latestWeight ? String(latestWeight) : '');
  }, [visible, latestWeight]);

  const handleSave = () => {
    const w = parseFloat(input);
    if (!w || w <= 0 || w > 500) return;
    onSave(w);
  };

  const sorted = weightLog.slice().reverse();
  const lastWeight = sorted[0]?.weight ?? null;
  const inputNum = parseFloat(input);
  const delta = lastWeight !== null && !isNaN(inputNum)
    ? Math.round((inputNum - lastWeight) * 10) / 10
    : null;

  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtDate = (s) => {
    const [y, m, d] = s.split('-');
    return new Date(+y, +m - 1, +d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

          {/* Nav bar */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: insets.top + 12, paddingBottom: 8 }}>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={{ fontSize: 15, color: C.accent, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 17, fontWeight: '700', color: C.t1 }}>Log Weight</Text>
            <Text style={{ fontSize: 13, color: C.t3 }}>{todayLabel}</Text>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>

            {/* Big number */}
            <View style={{ alignItems: 'center', paddingTop: 40, paddingBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
                <TextInput
                  style={{ fontSize: 48, fontWeight: '800', color: C.t1, letterSpacing: -2, minWidth: 80, textAlign: 'right', padding: 0, includeFontPadding: false }}
                  value={input}
                  onChangeText={setInput}
                  placeholder="—"
                  placeholderTextColor={C.t3}
                  keyboardType="decimal-pad"
                  onSubmitEditing={handleSave}
                  returnKeyType="done"
                  selectionColor={C.accent}
                />
                <Text style={{ fontSize: 18, fontWeight: '600', color: C.t3, paddingBottom: 9 }}>{weightUnit}</Text>
              </View>

              <View style={{ height: 26, justifyContent: 'center', marginTop: 4 }}>
                {delta !== null && delta !== 0 ? (
                  <Text style={{ fontSize: 15, fontWeight: '600', color: delta < 0 ? '#30D158' : '#FF9F0A' }}>
                    {delta > 0 ? '▲' : '▼'} {Math.abs(delta)} {weightUnit} from last
                  </Text>
                ) : delta === 0 ? (
                  <Text style={{ fontSize: 15, color: C.t3 }}>Same as last entry</Text>
                ) : lastWeight !== null ? (
                  <Text style={{ fontSize: 15, color: C.t3 }}>Last: {lastWeight} {weightUnit}</Text>
                ) : null}
              </View>
            </View>

            {/* Save */}
            <TouchableOpacity
              style={{ marginHorizontal: 20, marginTop: 24, marginBottom: 32, paddingVertical: 17, borderRadius: 16, backgroundColor: C.accent, alignItems: 'center' }}
              onPress={handleSave}
              activeOpacity={0.82}
            >
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>Save Weight</Text>
            </TouchableOpacity>

            {/* History */}
            {sorted.length > 0 && (
              <>
                <Text style={{ fontSize: 11, fontWeight: '700', color: C.t3, letterSpacing: 1.2, textTransform: 'uppercase', paddingHorizontal: 20, paddingBottom: 8 }}>History</Text>
                <View style={{ marginHorizontal: 16, borderRadius: 16, backgroundColor: C.surface, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4 }}>
                  {sorted.map((e, i, arr) => {
                    const prev = arr[i + 1];
                    const d = prev ? Math.round((e.weight - prev.weight) * 10) / 10 : null;
                    return (
                      <View key={e.date} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14, borderTopWidth: i === 0 ? 0 : 0.5, borderTopColor: C.border }}>
                        <Text style={{ fontSize: 14, color: C.t3, width: 68 }}>{fmtDate(e.date)}</Text>
                        <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: C.t1 }}>{e.weight} {weightUnit}</Text>
                        {d !== null && d !== 0 && (
                          <Text style={{ fontSize: 13, fontWeight: '600', color: d < 0 ? '#30D158' : '#FF9F0A' }}>
                            {d > 0 ? '+' : ''}{d}
                          </Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function ProfileScreen() {
  const { rerunOnboarding, setTheme, themeKey, subscriptionActive, trialDaysLeft, setShowPaywall } = useContext(AppActionsContext);
  const insets = useSafeAreaInsets();
  const C = useContext(ThemeContext);
  const styles = mkStyles(C);
  const prfStyles = mkPrfStyles(C);
  const [editMode,     setEditMode]     = useState(false);
  const [goalsOpen,    setGoalsOpen]    = useState(false);
  const [goals,        setGoals]        = useState(DEFAULT_GOALS);
  const [draft,        setDraft]        = useState(DEFAULT_GOALS);
  const [name,         setName]         = useState('You');
  const [draftName,    setDraftName]    = useState('You');
  const [showCalc,     setShowCalc]     = useState(false);
  const [wkCount,      setWkCount]      = useState(0);
  const [streak,       setStreak]       = useState(0);
  const [latestWeight,   setLatestWeight]   = useState(null);
  const [weightLog,      setWeightLog]      = useState([]);
  const [weightUnit,     setWeightUnit]     = useState('kg');
  const [showWeightModal,setShowWeightModal] = useState(false);
  const [joinedAt,       setJoinedAt]       = useState(null);

  useFocusEffect(useCallback(() => {
    AsyncStorage.multiGet([GOALS_KEY, WORKOUTS_KEY, WEIGHT_LOG_KEY, PROFILE_KEY, UNITS_KEY]).then(entries => {
      const byKey = Object.fromEntries(entries);
      if (byKey[GOALS_KEY])      { const g = parseStoredJson(byKey[GOALS_KEY], DEFAULT_GOALS); setGoals(g); setDraft(g); }
      if (byKey[PROFILE_KEY])    { const p = parseStoredJson(byKey[PROFILE_KEY], {}); setName(p.name || 'You'); setDraftName(p.name || 'You'); if (p.joinedAt) setJoinedAt(p.joinedAt); }
      if (byKey[WORKOUTS_KEY])   { const h = parseStoredJson(byKey[WORKOUTS_KEY], []); setWkCount(h.length); setStreak(computeStreak(h)); }
      if (byKey[WEIGHT_LOG_KEY]) { const l = parseStoredJson(byKey[WEIGHT_LOG_KEY], []); setWeightLog(l); if (l.length) setLatestWeight(l[l.length - 1].weight); }
      if (byKey[UNITS_KEY])      setWeightUnit(byKey[UNITS_KEY]);
    });
  }, []));

  const saveGoals = () => {
    const g = {
      calories: Number(draft.calories)||2300, protein: Number(draft.protein)||180,
      carbs: Number(draft.carbs)||250,        fat: Number(draft.fat)||70,
      fiber: Number(draft.fiber)||28,         sugar: Number(draft.sugar)||50,
      satFat: Number(draft.satFat)||20,       sodium: Number(draft.sodium)||2300,
    };
    const n = draftName.trim() || 'You';
    AsyncStorage.setItem(GOALS_KEY, JSON.stringify(g));
    AsyncStorage.setItem(PROFILE_KEY, JSON.stringify({ name: n }));
    setGoals(g); setDraft(g); setName(n); setDraftName(n); setEditMode(false); setGoalsOpen(false);
  };

  const initial = (name || 'Y').charAt(0).toUpperCase();

  return (
    <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: C.bg }]}>
      <StatusBar barStyle={C.statusBar} />

      {/* Nav bar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
        <Text style={{ fontSize: 28, fontWeight: '800', color: C.t1, letterSpacing: -0.8 }}>Profile</Text>
        {editMode
          ? <TouchableOpacity onPress={saveGoals} hitSlop={{ top:10,bottom:10,left:10,right:10 }}><Text style={{ fontSize: 15, color: C.accent, fontWeight: '700' }}>Save</Text></TouchableOpacity>
          : <TouchableOpacity onPress={() => { setDraft(goals); setDraftName(name); setEditMode(true); }} hitSlop={{ top:10,bottom:10,left:10,right:10 }}><Text style={{ fontSize: 15, color: C.accent, fontWeight: '600' }}>Edit</Text></TouchableOpacity>
        }
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={{ backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: 48 }}>

        {/* ── User hero card ── */}
        <View style={prfStyles.floatCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20 }}>
            <View style={{ width: 66, height: 66, borderRadius: 33, borderWidth: 2.5, borderColor: C.accent, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 22, fontWeight: '800', color: '#fff' }}>{initial}</Text>
              </View>
            </View>
            <View style={{ flex: 1 }}>
              {editMode ? (
                <TextInput
                  style={{ color: C.t1, fontSize: 18, fontWeight: '700', padding: 0, borderBottomWidth: 1.5, borderBottomColor: C.accent, paddingBottom: 3 }}
                  value={draftName} onChangeText={setDraftName}
                  placeholder="Your name" placeholderTextColor={C.t3} autoFocus
                />
              ) : (
                <Text style={{ fontSize: 18, fontWeight: '800', color: C.t1 }}>{name}</Text>
              )}
              <Text style={{ fontSize: 12, color: editMode ? C.accent : C.t3, marginTop: 4 }}>
                {editMode ? 'Editing display name' : joinedAt
                  ? `Member since ${new Date(joinedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
                  : 'Barbellz member'}
              </Text>
            </View>
          </View>

          {/* Stats strip inside hero card */}
          <View style={{ flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: C.border }}>
            <View style={{ flex: 1, alignItems: 'center', paddingVertical: 16 }}>
              <Text style={{ fontSize: 24, fontWeight: '800', color: C.t1, letterSpacing: -0.8 }}>{wkCount}</Text>
              <Text style={{ fontSize: 11, color: C.t3, marginTop: 3 }}>Workouts</Text>
            </View>
            <View style={{ width: 0.5, backgroundColor: C.border, marginVertical: 12 }} />
            <View style={{ flex: 1, alignItems: 'center', paddingVertical: 16 }}>
              <Text style={{ fontSize: 24, fontWeight: '800', color: streak > 0 ? '#FF9F0A' : C.t1, letterSpacing: -0.8 }}>{streak || 0}</Text>
              <Text style={{ fontSize: 11, color: C.t3, marginTop: 3 }}>Day Streak</Text>
            </View>
            <View style={{ width: 0.5, backgroundColor: C.border, marginVertical: 12 }} />
            <TouchableOpacity style={{ flex: 1, alignItems: 'center', paddingVertical: 16 }} activeOpacity={0.7} onPress={() => setShowWeightModal(true)}>
              <Text style={{ fontSize: 24, fontWeight: '800', color: C.t1, letterSpacing: -0.8 }}>{latestWeight ?? '—'}</Text>
              <Text style={{ fontSize: 11, color: C.t3, marginTop: 3 }}>{weightUnit}</Text>
              <Text style={{ fontSize: 8, color: C.accent, fontWeight: '700', marginTop: 3, letterSpacing: 1.2 }}>LOG</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── My Goals card ── */}
        <View style={[prfStyles.floatCard, { padding: 0 }]}>
          <View style={{ borderRadius: 18, overflow: 'hidden' }}>
            <TouchableOpacity onPress={() => setGoalsOpen(o => !o)} activeOpacity={0.7} style={{ paddingHorizontal: 20, paddingVertical: 16 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: C.t3, letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: 10 }}>My Goals</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 22, fontWeight: '800', color: C.t1, letterSpacing: -0.5 }}>
                  {goals.calories.toLocaleString()}<Text style={{ fontSize: 12, fontWeight: '400', color: C.t3 }}> kcal</Text>
                </Text>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#FFB340' }}>P {goals.protein}g</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#30D158' }}>C {goals.carbs}g</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#BF5AF2' }}>F {goals.fat}g</Text>
                </View>
                <Ionicons name={goalsOpen ? 'chevron-up' : 'chevron-down'} size={16} color={C.t3} />
              </View>
            </TouchableOpacity>

            {goalsOpen && (
              <>
                <View style={{ height: 0.5, backgroundColor: C.border }} />
                {editMode && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 2 }}>
                    <Ionicons name="pencil-outline" size={11} color={C.accent} />
                    <Text style={{ fontSize: 11, color: C.accent }}>Editing calories & macros</Text>
                  </View>
                )}
                {[
                  { label: 'Daily Calories', key: 'calories', unit: 'kcal', vc: C.t1,     dv: 2300 },
                  { label: 'Protein',        key: 'protein',  unit: 'g',    vc: '#FFB340', dv: 180  },
                  { label: 'Carbs',          key: 'carbs',    unit: 'g',    vc: '#30D158', dv: 250  },
                  { label: 'Fat',            key: 'fat',      unit: 'g',    vc: '#BF5AF2', dv: 70   },
                  { label: 'Fiber',          key: 'fiber',    unit: 'g',    vc: C.t2,      dv: 28   },
                  { label: 'Sugar',          key: 'sugar',    unit: 'g',    vc: C.t2,      dv: 50   },
                  { label: 'Saturated Fat',  key: 'satFat',   unit: 'g',    vc: C.t2,      dv: 20   },
                  { label: 'Sodium',         key: 'sodium',   unit: 'mg',   vc: C.t2,      dv: 2300 },
                ].map(g => (
                  <View key={g.label} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 13, borderTopWidth: 0.5, borderTopColor: C.border }}>
                    <Text style={{ fontSize: 14, color: C.t1 }}>{g.label}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      {editMode ? (
                        <TextInput
                          style={{ fontSize: 14, fontWeight: '700', color: g.vc, textAlign: 'right', minWidth: 52, backgroundColor: C.s2, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 }}
                          value={String(draft[g.key] ?? g.dv)}
                          onChangeText={v => setDraft(p => ({ ...p, [g.key]: v }))}
                          keyboardType="numeric" selectTextOnFocus
                        />
                      ) : (
                        <Text style={{ fontSize: 14, fontWeight: '700', color: g.vc }}>{goals[g.key] ?? g.dv}</Text>
                      )}
                      <Text style={{ fontSize: 11, color: C.t3, width: 30 }}>{g.unit}</Text>
                    </View>
                  </View>
                ))}
                {editMode && (
                  <View style={{ flexDirection: 'row', padding: 12, gap: 8 }}>
                    <TouchableOpacity
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: C.s2, alignItems: 'center' }}
                      onPress={() => Alert.alert('Recalculate Goals', 'This will restart the setup wizard and overwrite your current targets.', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Continue', onPress: rerunOnboarding },
                      ])}
                      activeOpacity={0.75}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: C.t1 }}>Recalculate</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flex: 2, paddingVertical: 12, borderRadius: 12, backgroundColor: C.accent, alignItems: 'center' }}
                      onPress={saveGoals} activeOpacity={0.75}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>Save Goals</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
          </View>
        </View>

        {/* ── Settings card (theme + future rows) ── */}
        <View style={[prfStyles.floatCard, { padding: 0 }]}>
          <View style={{ borderRadius: 18, overflow: 'hidden' }}>
            <View style={{ paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 14, color: C.t2 }}>Theme</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                {[
                  { key: 'grey',  label: 'Default', bg: '#1C1C1E', icon: 'moon',   ic: '#fff' },
                  { key: 'black', label: 'Black',   bg: '#000000', icon: 'planet', ic: '#fff' },
                  { key: 'light', label: 'Light',   bg: '#F2F2F7', icon: 'sunny',  ic: '#FF9F0A' },
                ].map(t => {
                  const active = themeKey === t.key;
                  return (
                    <TouchableOpacity key={t.key} onPress={() => setTheme(t.key)} activeOpacity={0.75} style={{ alignItems: 'center', gap: 4 }}>
                      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: t.bg,
                        borderWidth: active ? 2.5 : 1,
                        borderColor: active ? C.accent : 'rgba(128,128,128,0.18)',
                        alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name={t.icon} size={13} color={active && t.key !== 'light' ? C.accent : t.ic} />
                      </View>
                      <Text style={{ fontSize: 9, fontWeight: active ? '700' : '400', color: active ? C.accent : C.t3 }}>{t.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        </View>

        {/* ── Subscription card ── */}
        <View style={[prfStyles.floatCard, { padding: 0 }]}>
          <View style={{ borderRadius: 18, overflow: 'hidden', padding: 20 }}>
            {subscriptionActive ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: C.t1 }}>Barbellz Pro</Text>
                  <Text style={{ fontSize: 12, color: C.t3, marginTop: 3 }}>Active subscription</Text>
                </View>
                <View style={{ backgroundColor: C.accent + '20', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6 }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: C.accent, letterSpacing: 0.5 }}>PRO</Text>
                </View>
              </View>
            ) : trialDaysLeft > 0 ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <View>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: C.t1 }}>Free Trial</Text>
                    <Text style={{ fontSize: 12, color: C.t3, marginTop: 3 }}>Full access, no charge yet</Text>
                  </View>
                  <View style={{ backgroundColor: '#FF9F0A20', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6 }}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: '#FF9F0A' }}>{trialDaysLeft}d left</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => setShowPaywall(true)} activeOpacity={0.82}
                  style={{ backgroundColor: C.accent, borderRadius: 13, paddingVertical: 13, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Upgrade to Pro</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={{ fontSize: 15, fontWeight: '800', color: C.t1, marginBottom: 4 }}>Get Full Access</Text>
                <Text style={{ fontSize: 12, color: C.t3, marginBottom: 14 }}>Your trial has ended</Text>
                <TouchableOpacity onPress={() => setShowPaywall(true)} activeOpacity={0.82}
                  style={{ backgroundColor: C.accent, borderRadius: 13, paddingVertical: 13, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Subscribe to Pro</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* ── Legal / Support ── */}
        <View style={{ marginHorizontal: 16, marginTop: 8, backgroundColor: C.surface, borderRadius: 14, overflow: 'hidden' }}>
          {[
            { label: 'Privacy Policy',    icon: 'shield-checkmark-outline', onPress: () => Linking.openURL('https://ziyadalru.github.io/Barbell/privacy-policy') },
            { label: 'Terms of Use',      icon: 'document-text-outline',    onPress: () => Linking.openURL('https://ziyadalru.github.io/Barbell/terms') },
            { label: 'Support',           icon: 'help-circle-outline',      onPress: () => Linking.openURL('mailto:Arubz0@outlook.com?subject=Barbellz%20Support') },
          ].map((row, i, arr) => (
            <React.Fragment key={row.label}>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 }}
                activeOpacity={0.7}
                onPress={row.onPress}
              >
                <Ionicons name={row.icon} size={18} color={C.t2} />
                <Text style={{ flex: 1, fontSize: 15, color: C.t1 }}>{row.label}</Text>
                <Ionicons name="open-outline" size={14} color={C.t3} />
              </TouchableOpacity>
              {i < arr.length - 1 && <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 46 }} />}
            </React.Fragment>
          ))}
          <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 46 }} />
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 }}
            activeOpacity={0.7}
            onPress={async () => {
              try {
                const result = await restoreRevenueCatPurchases();
                Alert.alert(result.active ? 'Restored' : 'Nothing to restore', result.active ? 'Your Pro access is active.' : 'No active subscription found.');
              } catch (e) {
                Alert.alert('Restore failed', e?.message || 'Could not restore purchases.');
              }
            }}
          >
            <Ionicons name="refresh-outline" size={18} color={C.t2} />
            <Text style={{ flex: 1, fontSize: 15, color: C.t1 }}>Restore Purchases</Text>
            <Ionicons name="chevron-forward" size={14} color={C.t3} />
          </TouchableOpacity>
        </View>

        {/* ── Delete Account ── */}
        <TouchableOpacity
          style={{ marginHorizontal: 16, marginTop: 8, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 7 }}
          activeOpacity={0.7}
          onPress={() => Alert.alert(
            'Delete Account',
            'This will permanently delete your account and all data — workouts, nutrition logs, and progress. This cannot be undone.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete Account', style: 'destructive', onPress: () =>
                Alert.alert('Are you sure?', 'All your data will be erased forever.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Yes, Delete Everything', style: 'destructive', onPress: async () => {
                    await supabase.auth.signOut();
                    await AsyncStorage.clear();
                    rerunOnboarding();
                  }},
                ])
              },
            ]
          )}
        >
          <Ionicons name="trash-outline" size={15} color="#FF375F" style={{ opacity: 0.55 }} />
          <Text style={{ fontSize: 14, color: '#FF375F', fontWeight: '500', opacity: 0.55 }}>Delete Account</Text>
        </TouchableOpacity>

        {/* ── Log Out ── */}
        <TouchableOpacity
          style={{ marginHorizontal: 16, marginTop: 2, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 7 }}
          activeOpacity={0.7}
          onPress={() => Alert.alert('Log Out', 'Are you sure?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Log Out', style: 'destructive', onPress: async () => { await supabase.auth.signOut(); } },
          ])}
        >
          <Ionicons name="log-out-outline" size={15} color="#FF375F" style={{ opacity: 0.75 }} />
          <Text style={{ fontSize: 14, color: '#FF375F', fontWeight: '500', opacity: 0.75 }}>Log Out</Text>
        </TouchableOpacity>

        <Text style={{ textAlign: 'center', fontSize: 11, color: C.t3, marginTop: 4, opacity: 0.35 }}>Barbellz · v1.0</Text>

      </ScrollView>

      <WeightLogModal
        visible={showWeightModal}
        onClose={() => setShowWeightModal(false)}
        weightLog={weightLog}
        latestWeight={latestWeight}
        weightUnit={weightUnit}
        onSave={async (w) => {
          const entry = { date: todayStr(), weight: w };
          const raw = await AsyncStorage.getItem(WEIGHT_LOG_KEY);
          const log = parseStoredJson(raw, []);
          const updated = [...log.filter(e => e.date !== todayStr()), entry]
            .sort((a, b) => a.date.localeCompare(b.date));
          await AsyncStorage.setItem(WEIGHT_LOG_KEY, JSON.stringify(updated));
          setLatestWeight(w);
          setWeightLog(updated);
          setShowWeightModal(false);
        }}
      />

      <CalorieCalculatorModal
        visible={showCalc}
        onClose={() => setShowCalc(false)}
        onSave={async (g) => {
          await AsyncStorage.setItem(GOALS_KEY, JSON.stringify(g));
          setGoals(g); setDraft(g);
          setShowCalc(false);
        }}
      />
    </View>
  );
}

// ── CALORIE CALCULATOR MODAL ─────────────────────────────
function CalorieCalculatorModal({ visible, onClose, onSave }) {
  const C = useContext(ThemeContext);
  const [step,     setStep]     = useState(0);
  const [gender,   setGender]   = useState('male');
  const [age,      setAge]      = useState('');
  const [height,   setHeight]   = useState('');
  const [weight,   setWeight]   = useState('');
  const [activity, setActivity] = useState(1.55);
  const [goal,     setGoal]     = useState('maintain');
  const [calories, setCalories] = useState(2000);

  const ACTIVITY_OPTS = [
    { label: 'Sedentary',       sub: 'Little or no exercise',          val: 1.2   },
    { label: 'Lightly Active',  sub: '1–3 days/week',                  val: 1.375 },
    { label: 'Moderately Active', sub: '3–5 days/week',                val: 1.55  },
    { label: 'Very Active',     sub: '6–7 days/week',                  val: 1.725 },
  ];
  const GOAL_OPTS = [
    { label: 'Lose Fat',      sub: '500 kcal deficit',  val: 'lose',     adj: -500 },
    { label: 'Maintain',      sub: 'Stay at current weight', val: 'maintain', adj: 0 },
    { label: 'Gain Muscle',   sub: '300 kcal surplus',  val: 'gain',     adj: 300  },
  ];

  const calcCalories = () => {
    const a = parseFloat(age) || 25;
    const h = parseFloat(height) || 170;
    const w = parseFloat(weight) || 70;
    const bmr = gender === 'male'
      ? 10 * w + 6.25 * h - 5 * a + 5
      : 10 * w + 6.25 * h - 5 * a - 161;
    const tdee = bmr * activity;
    const adj  = GOAL_OPTS.find(g => g.val === goal)?.adj ?? 0;
    return Math.round(tdee + adj);
  };

  const goNext = () => {
    if (step === 3) {
      setCalories(calcCalories());
      setStep(4);
    } else {
      setStep(s => s + 1);
    }
  };

  const handleSave = () => {
    const w  = parseFloat(weight) || 70;
    const p  = Math.round(w * 2.2);
    const f  = Math.round((calories * 0.25) / 9);
    const c  = Math.round((calories - p * 4 - f * 9) / 4);
    onSave({
      calories,
      protein: p,
      carbs:   Math.max(c, 50),
      fat:     f,
      fiber:   28,
      sugar:   50,
      satFat:  20,
      sodium:  2300,
    });
    setStep(0);
  };

  const handleClose = () => { setStep(0); onClose(); };

  const canNext = () => {
    if (step === 1) return age && height && weight;
    return true;
  };

  const STEPS = ['Gender', 'Stats', 'Activity', 'Goal', 'Results'];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>

        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                       paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 }}>
          <TouchableOpacity onPress={handleClose}>
            <Text style={{ color: C.t3, fontSize: 16 }}>Cancel</Text>
          </TouchableOpacity>
          <Text style={{ color: C.t1, fontSize: 17, fontWeight: '700' }}>Calorie Calculator</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* Progress dots */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 28 }}>
          {STEPS.map((_, i) => (
            <View key={i} style={{ width: i === step ? 20 : 6, height: 6, borderRadius: 3,
                                   backgroundColor: i <= step ? C.accent : C.s3 }} />
          ))}
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}>

          {step === 0 && (
            <>
              <Text style={{ color: C.t1, fontSize: 22, fontWeight: '800', marginBottom: 8 }}>Select gender</Text>
              <Text style={{ color: C.t3, fontSize: 14, marginBottom: 28 }}>Used for the BMR formula</Text>
              {['male', 'female'].map(g => (
                <TouchableOpacity key={g} onPress={() => setGender(g)} activeOpacity={0.75}
                  style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: gender === g ? C.accent : C.surface,
                           borderRadius: 14, paddingHorizontal: 20, paddingVertical: 18, marginBottom: 12 }}>
                  <Ionicons name={g === 'male' ? 'male' : 'female'} size={22}
                            color={gender === g ? '#fff' : C.t2} style={{ marginRight: 14 }} />
                  <Text style={{ fontSize: 17, fontWeight: '600', color: gender === g ? '#fff' : C.t1 }}>
                    {g.charAt(0).toUpperCase() + g.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </>
          )}

          {step === 1 && (
            <>
              <Text style={{ color: C.t1, fontSize: 22, fontWeight: '800', marginBottom: 28 }}>Your stats</Text>
              {[
                { label: 'Age',    key: 'age',    state: age,    set: setAge,    placeholder: 'e.g. 25',  unit: 'years' },
                { label: 'Height', key: 'height', state: height, set: setHeight, placeholder: 'e.g. 175', unit: 'cm'    },
                { label: 'Weight', key: 'weight', state: weight, set: setWeight, placeholder: 'e.g. 75',  unit: 'kg'    },
              ].map(f => (
                <View key={f.key} style={{ marginBottom: 16 }}>
                  <Text style={{ color: C.t2, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>{f.label}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface,
                                 borderRadius: 12, paddingHorizontal: 16 }}>
                    <TextInput style={{ flex: 1, color: C.t1, fontSize: 17, paddingVertical: 14 }}
                      value={f.state} onChangeText={f.set} keyboardType="decimal-pad"
                      placeholder={f.placeholder} placeholderTextColor={C.t3} />
                    <Text style={{ color: C.t3, fontSize: 14 }}>{f.unit}</Text>
                  </View>
                </View>
              ))}
            </>
          )}

          {step === 2 && (
            <>
              <Text style={{ color: C.t1, fontSize: 22, fontWeight: '800', marginBottom: 8 }}>Activity level</Text>
              <Text style={{ color: C.t3, fontSize: 14, marginBottom: 28 }}>How active are you each week?</Text>
              {ACTIVITY_OPTS.map(opt => (
                <TouchableOpacity key={opt.val} onPress={() => setActivity(opt.val)} activeOpacity={0.75}
                  style={{ backgroundColor: activity === opt.val ? C.accent : C.surface,
                           borderRadius: 14, paddingHorizontal: 20, paddingVertical: 16, marginBottom: 10 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: activity === opt.val ? '#fff' : C.t1, marginBottom: 3 }}>
                    {opt.label}
                  </Text>
                  <Text style={{ fontSize: 13, color: activity === opt.val ? 'rgba(255,255,255,0.75)' : C.t3 }}>
                    {opt.sub}
                  </Text>
                </TouchableOpacity>
              ))}
            </>
          )}

          {step === 3 && (
            <>
              <Text style={{ color: C.t1, fontSize: 22, fontWeight: '800', marginBottom: 8 }}>Your goal</Text>
              <Text style={{ color: C.t3, fontSize: 14, marginBottom: 28 }}>We'll set your daily calorie target accordingly</Text>
              {GOAL_OPTS.map(opt => (
                <TouchableOpacity key={opt.val} onPress={() => setGoal(opt.val)} activeOpacity={0.75}
                  style={{ backgroundColor: goal === opt.val ? C.accent : C.surface,
                           borderRadius: 14, paddingHorizontal: 20, paddingVertical: 16, marginBottom: 10 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: goal === opt.val ? '#fff' : C.t1, marginBottom: 3 }}>
                    {opt.label}
                  </Text>
                  <Text style={{ fontSize: 13, color: goal === opt.val ? 'rgba(255,255,255,0.75)' : C.t3 }}>
                    {opt.sub}
                  </Text>
                </TouchableOpacity>
              ))}
            </>
          )}

          {step === 4 && (
            <>
              <Text style={{ color: C.t1, fontSize: 22, fontWeight: '800', marginBottom: 4 }}>Your daily target</Text>
              <Text style={{ color: C.t3, fontSize: 14, marginBottom: 28 }}>Adjust if needed, then save</Text>

              <View style={{ backgroundColor: C.surface, borderRadius: 20, padding: 24, alignItems: 'center', marginBottom: 28 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 24 }}>
                  <TouchableOpacity onPress={() => setCalories(c => Math.max(800, c - 50))}
                    style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.s2,
                             alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="remove" size={22} color={C.t1} />
                  </TouchableOpacity>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ fontSize: 52, fontWeight: '900', color: C.accent, letterSpacing: -1 }}>
                      {calories.toLocaleString()}
                    </Text>
                    <Text style={{ fontSize: 14, color: C.t3, fontWeight: '600' }}>kcal / day</Text>
                  </View>
                  <TouchableOpacity onPress={() => setCalories(c => Math.min(6000, c + 50))}
                    style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.s2,
                             alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="add" size={22} color={C.t1} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Macro breakdown preview */}
              {(() => {
                const w = parseFloat(weight) || 70;
                const p = Math.round(w * 2.2);
                const f = Math.round((calories * 0.25) / 9);
                const c = Math.max(Math.round((calories - p * 4 - f * 9) / 4), 50);
                return (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 28 }}>
                    {[{ label: 'Protein', val: `${p}g`, color: '#FFB340' },
                      { label: 'Carbs',   val: `${c}g`, color: '#30D158' },
                      { label: 'Fat',     val: `${f}g`, color: '#BF5AF2' }].map(m => (
                      <View key={m.label} style={{ flex: 1, alignItems: 'center', backgroundColor: C.surface,
                                                   borderRadius: 14, paddingVertical: 14, marginHorizontal: 4 }}>
                        <Text style={{ fontSize: 18, fontWeight: '800', color: m.color }}>{m.val}</Text>
                        <Text style={{ fontSize: 12, color: C.t3, marginTop: 3 }}>{m.label}</Text>
                      </View>
                    ))}
                  </View>
                );
              })()}

              <TouchableOpacity onPress={handleSave}
                style={{ backgroundColor: C.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Save Goals</Text>
              </TouchableOpacity>
            </>
          )}

        </ScrollView>

        {step < 4 && (
          <View style={{ paddingHorizontal: 24, paddingBottom: 40 }}>
            {step > 0 && (
              <TouchableOpacity onPress={() => setStep(s => s - 1)}
                style={{ paddingVertical: 14, alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ color: C.t3, fontSize: 15 }}>Back</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={goNext} disabled={!canNext()}
              style={{ backgroundColor: canNext() ? C.accent : C.s3, borderRadius: 14,
                       paddingVertical: 16, alignItems: 'center' }}>
              <Text style={{ color: canNext() ? '#fff' : C.t3, fontSize: 16, fontWeight: '700' }}>Continue</Text>
            </TouchableOpacity>
          </View>
        )}

      </View>
    </Modal>
  );
}

// ── PAYWALL MODAL ─────────────────────────────────────────
function PaywallModal({ visible, daysLeft, packages = [], selectedPackage, onSelectPackage, onSubscribe, onRestore, onClose, loading, configured }) {
  const C = useContext(ThemeContext);
  const fallbackPlans = [
    { id: 'monthly', label: 'Monthly', price: 'SAR 39.99', sub: 'per month' },
    { id: 'yearly',  label: 'Yearly',  price: 'SAR 229.99', sub: 'per year', badge: 'BEST VALUE' },
  ];
  const plans = packages.length
    ? packages.map(pkg => {
        const type = String(pkg.packageType || '').toLowerCase();
        const isYearly = type.includes('annual') || type.includes('year');
        const isMonthly = type.includes('month');
        return {
          id: pkg.identifier,
          pkg,
          label: isYearly ? 'Yearly' : isMonthly ? 'Monthly' : (pkg.product?.title || 'Subscription'),
          price: pkg.product?.priceString || '',
          sub: isYearly ? 'per year' : isMonthly ? 'per month' : (pkg.product?.description || ''),
          badge: isYearly ? 'BEST VALUE' : null,
        };
      })
    : fallbackPlans;
  const activePlanId = selectedPackage?.identifier || plans.find(p => p.badge)?.id || plans[0]?.id;

  const FEATURES = [
    { icon: 'barbell-outline',       text: 'Unlimited workout logging & routines' },
    { icon: 'restaurant-outline',    text: 'Full nutrition tracking & barcode scanner' },
    { icon: 'camera-outline',        text: 'AI meal scanner & label reader' },
    { icon: 'stats-chart-outline',   text: 'Progress charts & personal records' },
    { icon: 'calculator-outline',    text: 'Calorie calculator & smart goal setting' },
    { icon: 'trophy-outline',         text: 'Unlimited PRs, streaks & insights' },
  ];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => { if (daysLeft > 0) onClose?.(); }}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

          {/* Hero */}
          <View style={{ alignItems: 'center', paddingTop: 60, paddingBottom: 32, paddingHorizontal: 24 }}>
            <View style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: C.accent,
                           alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
              <Ionicons name="barbell" size={38} color="#fff" />
            </View>
            <Text style={{ fontSize: 30, fontWeight: '900', color: C.t1, letterSpacing: -0.8, marginBottom: 8 }}>
              Barbellz Pro
            </Text>
            {daysLeft > 0 ? (
              <Text style={{ fontSize: 15, color: C.t3, textAlign: 'center' }}>
                Your free trial ends in <Text style={{ color: C.accent, fontWeight: '700' }}>{daysLeft} day{daysLeft !== 1 ? 's' : ''}</Text>
              </Text>
            ) : (
              <Text style={{ fontSize: 15, color: '#FF375F', textAlign: 'center', fontWeight: '600' }}>
                Your free trial has ended
              </Text>
            )}
          </View>

          {/* Features */}
          <View style={{ paddingHorizontal: 24, marginBottom: 28 }}>
            {FEATURES.map(f => (
              <View key={f.text} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 14 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: C.surface,
                               alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={f.icon} size={18} color={C.accent} />
                </View>
                <Text style={{ flex: 1, fontSize: 15, color: C.t1 }}>{f.text}</Text>
              </View>
            ))}
          </View>

          {/* Plan toggle */}
          <View style={{ marginHorizontal: 24, marginBottom: 20 }}>
            {plans.map(p => (
              <TouchableOpacity key={p.id} onPress={() => p.pkg && onSelectPackage?.(p.pkg)} activeOpacity={0.8}
                style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: activePlanId === p.id ? C.accent : C.surface,
                         borderRadius: 14, padding: 18, marginBottom: 10 }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: activePlanId === p.id ? '#fff' : C.t1 }}>{p.label}</Text>
                    {p.badge && (
                      <View style={{ backgroundColor: activePlanId === p.id ? 'rgba(255,255,255,0.25)' : C.accent,
                                     borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 9, fontWeight: '800', color: '#fff', letterSpacing: 0.5 }}>{p.badge}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ fontSize: 12, color: activePlanId === p.id ? 'rgba(255,255,255,0.7)' : C.t3, marginTop: 2 }}>{p.sub}</Text>
                </View>
                <Text style={{ fontSize: 20, fontWeight: '800', color: activePlanId === p.id ? '#fff' : C.t1 }}>{p.price}</Text>
              </TouchableOpacity>
            ))}
            {!configured && (
              <Text style={{ color: '#FFB340', fontSize: 12, lineHeight: 17, marginTop: 4 }}>
                RevenueCat is not configured yet. Add your iOS API key to enable real purchases.
              </Text>
            )}
          </View>

          {/* Subscribe button */}
          <View style={{ paddingHorizontal: 24 }}>
            <TouchableOpacity onPress={onSubscribe} activeOpacity={0.85} disabled={loading || !configured || !selectedPackage}
              style={{ backgroundColor: configured && selectedPackage ? C.accent : C.s3, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}>{loading ? 'Processing...' : 'Start Subscription'}</Text>
            </TouchableOpacity>

            {daysLeft > 0 && (
              <TouchableOpacity onPress={onClose} activeOpacity={0.7}
                style={{ paddingVertical: 14, alignItems: 'center' }}>
                <Text style={{ color: C.t3, fontSize: 15 }}>Continue free trial</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity onPress={onRestore} disabled={loading || !configured} activeOpacity={0.7} style={{ paddingVertical: 12, alignItems: 'center' }}>
              <Text style={{ color: C.t3, fontSize: 13 }}>Restore Purchases</Text>
            </TouchableOpacity>

            <Text style={{ color: C.t3, fontSize: 11, textAlign: 'center', marginTop: 8, lineHeight: 16 }}>
              Cancel anytime. Subscriptions renew automatically.
            </Text>
          </View>

        </ScrollView>
      </View>
    </Modal>
  );
}

// ── AUTH SCREEN ───────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const C = useContext(ThemeContext);
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);

  const barAnim    = useRef(new Animated.Value(0)).current;
  const leftPlate  = useRef(new Animated.Value(-110)).current;
  const rightPlate = useRef(new Animated.Value(110)).current;
  const brandAnim  = useRef(new Animated.Value(0)).current;
  const formAnim   = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(barAnim, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(80),
        Animated.parallel([
          Animated.spring(leftPlate,  { toValue: 0, damping: 16, stiffness: 180, useNativeDriver: true }),
          Animated.spring(rightPlate, { toValue: 0, damping: 16, stiffness: 180, useNativeDriver: true }),
        ]),
      ]),
      Animated.sequence([
        Animated.delay(160),
        Animated.parallel([
          Animated.timing(brandAnim, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.spring(formAnim,  { toValue: 1, damping: 22, stiffness: 180, useNativeDriver: true }),
        ]),
      ]),
    ]).start();
  }, []);

  const handleSignIn = async () => {
    setError('');
    if (!email || !password) { setError('Please fill in all fields.'); return; }
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err) { setError(err.message); } else { onAuth(); }
    } catch (e) {
      setError(e.message || 'Sign in failed.');
    } finally { setLoading(false); }
  };

  const handleSignUp = async () => {
    setError('');
    if (!email || !password || !confirmPassword) { setError('Please fill in all fields.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setLoading(true);
    try {
      const { data, error: err } = await supabase.auth.signUp({ email: email.trim(), password });
      if (err) {
        setError(err.message);
      } else if (data.session) {
        onAuth(true);
      } else {
        // Email confirmation required — show instructions, switch to sign-in
        setConfirmSent(true);
        setMode('signin');
      }
    } catch (e) {
      setError(e.message || 'Sign up failed.');
    } finally { setLoading(false); }
  };

  const handleForgot = async () => {
    setError('');
    if (!email) { setError('Please enter your email address.'); return; }
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (err) { setError(err.message); } else { setResetSent(true); }
    } catch (e) {
      setError(e.message || 'Failed to send reset email.');
    } finally { setLoading(false); }
  };

  const switchMode = (m) => {
    setMode(m); setError(''); setResetSent(''); setConfirmSent(false); setPassword(''); setConfirmPassword('');
  };

  const handleAppleSignIn = async () => {
    setError('');
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      const { error: err } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      });
      if (err) { setError(err.message); } else { onAuth(true); }
    } catch (e) {
      if (e.code !== 'ERR_REQUEST_CANCELED') {
        setError(e.message || 'Apple Sign In failed.');
      }
    }
  };

  // Plate component
  const glowStyle = {
    shadowColor: C.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 14,
  };

  const Plate = ({ side }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {side === 'left' ? (
        <>
          <View style={{ width: 7,  height: 22, backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 2, marginRight: 2 }} />
          <View style={{ width: 11, height: 40, backgroundColor: 'rgba(10,132,255,0.55)', borderRadius: 3, marginRight: 2 }} />
          <View style={[{ width: 15, height: 62, backgroundColor: C.accent, borderRadius: 4, marginRight: 3 }, glowStyle]} />
          <View style={{ width: 9,  height: 28, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 2 }} />
        </>
      ) : (
        <>
          <View style={{ width: 9,  height: 28, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 2 }} />
          <View style={[{ width: 15, height: 62, backgroundColor: C.accent, borderRadius: 4, marginLeft: 3 }, glowStyle]} />
          <View style={{ width: 11, height: 40, backgroundColor: 'rgba(10,132,255,0.55)', borderRadius: 3, marginLeft: 2 }} />
          <View style={{ width: 7,  height: 22, backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 2, marginLeft: 2 }} />
        </>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#04080F' }}>

        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets={true}
        >
          {/* ── Barbell hero ── */}
          <View style={{ alignItems: 'center', paddingTop: insets.top + 52, marginBottom: 36 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', height: 70 }}>
              {/* Left plates */}
              <Animated.View style={{ transform: [{ translateX: leftPlate }] }}>
                <Plate side="left" />
              </Animated.View>

              {/* Bar */}
              <Animated.View style={{ opacity: barAnim }}>
                <View style={{ width: 130, height: 5, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 3 }} />
              </Animated.View>

              {/* Right plates */}
              <Animated.View style={{ transform: [{ translateX: rightPlate }] }}>
                <Plate side="right" />
              </Animated.View>
            </View>

            {/* Brand */}
            <Animated.View style={{ alignItems: 'center', marginTop: 28, opacity: brandAnim, transform: [{ translateY: brandAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
              <Text style={{ fontSize: 42, fontWeight: '800', color: '#fff', letterSpacing: -1.5,  }}>Barbellz</Text>
              <Text style={{ fontSize: 11, color: C.accent, fontWeight: '700', letterSpacing: 3.5, marginTop: 8, textTransform: 'uppercase' }}>
                Lift · Track · Grow
              </Text>
            </Animated.View>
          </View>

          {/* ── Form ── */}
          <Animated.View style={{
            paddingHorizontal: 24,
            opacity: formAnim,
            transform: [{ translateY: formAnim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }],
          }}>
            {/* Context heading */}
            <Text style={{ fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: -0.5, marginBottom: 20 }}>
              {mode === 'signin' ? 'Welcome back.' : mode === 'signup' ? 'Create your account.' : 'Reset your password.'}
            </Text>

            {mode === 'forgot' && (
              <TouchableOpacity onPress={() => switchMode('signin')} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 2 }}>
                <Ionicons name="chevron-back" size={16} color={C.accent} />
                <Text style={{ color: C.accent, fontSize: 14, fontWeight: '500' }}>Back to Sign In</Text>
              </TouchableOpacity>
            )}

            {/* Grouped inputs */}
            <View style={{ backgroundColor: C.surface, borderRadius: 14, overflow: 'hidden', marginBottom: 10 }}>
              <TextInput
                style={{ paddingHorizontal: 16, paddingVertical: 16, fontSize: 16, color: C.t1, borderBottomWidth: 0.5, borderBottomColor: C.border }}
                placeholder="Email"
                placeholderTextColor={C.t3}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
              />
              {mode !== 'forgot' && (
                <TextInput
                  style={[
                    { paddingHorizontal: 16, paddingVertical: 16, fontSize: 16, color: C.t1 },
                    mode === 'signup' && { borderBottomWidth: 0.5, borderBottomColor: C.border },
                  ]}
                  placeholder="Password"
                  placeholderTextColor={C.t3}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                />
              )}
              {mode === 'signup' && (
                <TextInput
                  style={{ paddingHorizontal: 16, paddingVertical: 16, fontSize: 16, color: C.t1 }}
                  placeholder="Confirm Password"
                  placeholderTextColor={C.t3}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                />
              )}
            </View>

            {mode === 'signin' && (
              <TouchableOpacity onPress={() => switchMode('forgot')} style={{ alignSelf: 'flex-end', paddingVertical: 6, marginBottom: 20 }}>
                <Text style={{ color: C.accent, fontSize: 14, fontWeight: '500' }}>Forgot password?</Text>
              </TouchableOpacity>
            )}

            {!!error && <Text style={{ color: '#FF453A', fontSize: 14, marginBottom: 12, fontWeight: '500' }}>{error}</Text>}
            {resetSent && <Text style={{ color: '#30D158', fontSize: 14, marginBottom: 12, fontWeight: '500' }}>Reset link sent! Check your email.</Text>}
            {confirmSent && <Text style={{ color: '#30D158', fontSize: 14, marginBottom: 12, fontWeight: '500' }}>Account created! Check your email to confirm, then sign in.</Text>}

            {/* CTA */}
            {!resetSent && (
              <TouchableOpacity
                onPress={mode === 'signin' ? handleSignIn : mode === 'signup' ? handleSignUp : handleForgot}
                disabled={loading}
                activeOpacity={0.84}
                style={{
                  backgroundColor: C.accent, borderRadius: 14, paddingVertical: 17, alignItems: 'center',
                  opacity: loading ? 0.7 : 1,
                  shadowColor: C.accent, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 16,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700', letterSpacing: -0.2 }}>
                  {loading ? 'Loading…' : mode === 'signin' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Reset Link'}
                </Text>
              </TouchableOpacity>
            )}

            {mode !== 'forgot' && (
              <>
                {/* Divider */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 28, gap: 10 }}>
                  <View style={{ flex: 1, height: 0.5, backgroundColor: C.border }} />
                  <Text style={{ color: C.t3, fontSize: 12, fontWeight: '500' }}>or</Text>
                  <View style={{ flex: 1, height: 0.5, backgroundColor: C.border }} />
                </View>

                {/* Apple Sign In */}
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                  cornerRadius={14}
                  style={{ width: '100%', height: 44, marginTop: 16 }}
                  onPress={handleAppleSignIn}
                />

                {/* Switch mode */}
                <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 24, gap: 4 }}>
                  <Text style={{ color: C.t3, fontSize: 15 }}>
                    {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}
                  </Text>
                  <TouchableOpacity onPress={() => switchMode(mode === 'signin' ? 'signup' : 'signin')} activeOpacity={0.7}>
                    <Text style={{ color: C.accent, fontSize: 15, fontWeight: '600' }}>
                      {mode === 'signin' ? ' Sign up' : ' Sign in'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {mode === 'signup' && (
              <Text style={{ color: C.t3, fontSize: 12, textAlign: 'center', marginTop: 20, lineHeight: 17 }}>
                30-day free trial · Cancel anytime
              </Text>
            )}
          </Animated.View>
        </ScrollView>
    </View>
  );
}

// ── ONBOARDING SCREEN ─────────────────────────────────────
function OnboardingScreen({ onDone }) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 5;

  const stepAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    stepAnim.setValue(0);
    Animated.timing(stepAnim, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [step]);

  const [name,      setName]      = useState('');
  const [goal,      setGoal]      = useState('');
  const [units,     setUnits]     = useState('metric');
  const [sex,       setSex]       = useState('Male');
  const [age,       setAge]       = useState('');
  const [weight,    setWeight]    = useState('');
  const [height,    setHeight]    = useState('');
  const [heightIn,  setHeightIn]  = useState('');
  const [activity,  setActivity]  = useState('');

  const toggleUnits = (next) => {
    if (next === units) return;
    if (next === 'imperial') {
      if (weight) setWeight(String(Math.round(parseFloat(weight) * 2.2046 * 10) / 10));
      if (height) {
        const totalIn = parseFloat(height) / 2.54;
        setHeight(String(Math.floor(totalIn / 12)));
        setHeightIn(String(Math.round(totalIn % 12)));
      }
    } else {
      if (weight) setWeight(String(Math.round(parseFloat(weight) / 2.2046 * 10) / 10));
      if (height) {
        setHeight(String(Math.round((parseFloat(height) * 30.48) + (parseFloat(heightIn || 0) * 2.54))));
        setHeightIn('');
      }
    }
    setUnits(next);
  };

  const goals1 = [
    { id: 'Lose Fat',     emoji: '🔥', label: 'Lose Fat',     sub: 'Calorie deficit to drop body fat' },
    { id: 'Maintain',     emoji: '⚖️',  label: 'Maintain',     sub: 'Eat at maintenance calories' },
    { id: 'Build Muscle', emoji: '💪',  label: 'Build Muscle', sub: 'Calorie surplus to gain strength' },
  ];

  const activityOptions = [
    { id: 'Sedentary',         emoji: '🛋️', label: 'Sedentary',         sub: 'Little or no exercise' },
    { id: 'Lightly Active',    emoji: '🚶', label: 'Lightly Active',    sub: '1–3 days/week' },
    { id: 'Moderately Active', emoji: '🏃', label: 'Moderately Active', sub: '3–5 days/week' },
    { id: 'Very Active',       emoji: '🔥', label: 'Very Active',       sub: '6–7 days/week' },
  ];

  const calcMacros = () => {
    const w = units === 'imperial' ? parseFloat(weight) / 2.2046 : parseFloat(weight);
    const h = units === 'imperial'
      ? (parseFloat(height || 0) * 30.48) + (parseFloat(heightIn || 0) * 2.54)
      : parseFloat(height);
    const a = parseFloat(age);
    const bmr = sex === 'Male' ? 10*w + 6.25*h - 5*a + 5 : 10*w + 6.25*h - 5*a - 161;
    const mult = { Sedentary: 1.2, 'Lightly Active': 1.375, 'Moderately Active': 1.55, 'Very Active': 1.725 };
    const tdee = bmr * mult[activity];
    const calories = Math.round(goal === 'Lose Fat' ? tdee - 500 : goal === 'Build Muscle' ? tdee + 300 : tdee);
    const protein  = Math.round(w * 2.0);
    const fat      = Math.round(calories * 0.28 / 9);
    const carbs    = Math.round((calories - protein * 4 - fat * 9) / 4);
    return { calories, protein, fat, carbs };
  };

  const canAdvance = () => {
    if (step === 1) return name.trim().length > 0;
    if (step === 2) return !!goal;
    if (step === 3) return !!sex && !!age && !!weight && !!height;
    if (step === 4) return !!activity;
    return true;
  };

  const handleFinish = async () => {
    const { calories, protein, carbs, fat } = calcMacros();
    await AsyncStorage.setItem(GOALS_KEY,    JSON.stringify({ calories, protein, carbs, fat, fiber: 28, sugar: 50, satFat: 20, sodium: 2300 }));
    await AsyncStorage.setItem(PROFILE_KEY,  JSON.stringify({ name: name.trim(), joinedAt: new Date().toISOString() }));
    await AsyncStorage.setItem(ONBOARDING_KEY, 'done');
    onDone();
  };

  const macros   = step === 5 ? calcMacros() : null;
  const firstName = name.trim().split(' ')[0];

  const stepStyle = {
    opacity: stepAnim,
    transform: [{ translateY: stepAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
  };

  const SelectCard = ({ selected, onPress, emoji, label, sub }) => (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: selected ? C.accent : C.surface,
        borderRadius: 16, padding: 18, marginBottom: 10,
        borderWidth: 1.5, borderColor: selected ? C.accent : C.border,
        ...(selected ? { shadowColor: C.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 14 } : {}),
      }}
    >
      <Text style={{ fontSize: 30, marginRight: 16, width: 36, textAlign: 'center' }}>{emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: selected ? '#fff' : C.t1, letterSpacing: -0.3 }}>{label}</Text>
        <Text style={{ fontSize: 13, color: selected ? 'rgba(255,255,255,0.75)' : C.t3, marginTop: 2, fontWeight: '500' }}>{sub}</Text>
      </View>
      {selected && <Ionicons name="checkmark-circle" size={22} color="#fff" style={{ marginLeft: 8 }} />}
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#04080F' }}>
      <ScrollView
        automaticallyAdjustKeyboardInsets={true}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 32 }}
      >
        {/* ── Header ── */}
        <View style={{ alignItems: 'center', paddingTop: insets.top + 20, marginBottom: 24 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: -0.6 }}>Barbellz</Text>
          <Text style={{ fontSize: 10, color: C.accent, fontWeight: '700', letterSpacing: 3, marginTop: 3, textTransform: 'uppercase' }}>Lift · Track · Grow</Text>
        </View>

        {/* ── Progress ── */}
        {step > 1 && (
          <View style={{ flexDirection: 'row', gap: 5, marginBottom: 28, paddingHorizontal: 24 }}>
            {Array.from({ length: TOTAL_STEPS - 1 }, (_, i) => (
              <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i < step - 1 ? C.accent : 'rgba(255,255,255,0.10)' }} />
            ))}
          </View>
        )}

        <Animated.View style={[stepStyle, { paddingHorizontal: 24, flex: 1 }]}>

          {/* ── Step 1 — Welcome / Name ── */}
          {step === 1 && (
            <View style={{ flex: 1, justifyContent: 'center', paddingBottom: 40 }}>
              <Text style={{ fontSize: 38, fontWeight: '900', color: '#fff', letterSpacing: -1.2, marginBottom: 10, lineHeight: 44 }}>
                Welcome to{'\n'}Barbellz. 👋
              </Text>
              <Text style={{ fontSize: 16, color: C.t2, fontWeight: '500', lineHeight: 24, marginBottom: 40 }}>
                Your personal fitness companion for tracking workouts and nutrition. Let's get you set up in under a minute.
              </Text>
              <Text style={{ fontSize: 13, color: C.t3, fontWeight: '600', letterSpacing: 0.5, marginBottom: 10, textTransform: 'uppercase' }}>What should we call you?</Text>
              <View style={{ backgroundColor: C.surface, borderRadius: 14, overflow: 'hidden' }}>
                <TextInput
                  style={{ paddingHorizontal: 18, paddingVertical: 18, color: C.t1, fontSize: 20, fontWeight: '600' }}
                  placeholder="Your name"
                  placeholderTextColor={C.t3}
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={() => { if (canAdvance()) setStep(2); }}
                />
              </View>
            </View>
          )}

          {/* ── Step 2 — Goal ── */}
          {step === 2 && (
            <View>
              <Text style={{ fontSize: 28, fontWeight: '800', color: '#fff', letterSpacing: -0.8, marginBottom: 6 }}>
                {firstName ? `What's your goal, ${firstName}?` : "What's your goal?"}
              </Text>
              <Text style={{ fontSize: 15, color: C.t3, marginBottom: 24, fontWeight: '500', lineHeight: 22 }}>We'll set your calorie targets to match.</Text>
              {goals1.map(g => (
                <SelectCard key={g.id} selected={goal === g.id} onPress={() => setGoal(g.id)} emoji={g.emoji} label={g.label} sub={g.sub} />
              ))}
            </View>
          )}

          {/* ── Step 3 — Body info ── */}
          {step === 3 && (
            <View>
              <Text style={{ fontSize: 28, fontWeight: '800', color: '#fff', letterSpacing: -0.8, marginBottom: 6 }}>A bit about you</Text>
              <Text style={{ fontSize: 15, color: C.t3, marginBottom: 24, fontWeight: '500', lineHeight: 22 }}>Needed to calculate your calorie target accurately.</Text>

              {/* Sex + Units */}
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: C.t3, fontWeight: '600', letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' }}>Sex</Text>
                  <View style={{ flexDirection: 'row', backgroundColor: C.surface, borderRadius: 12, padding: 3 }}>
                    {['Male', 'Female'].map(s => (
                      <TouchableOpacity key={s} onPress={() => setSex(s)}
                        style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: sex === s ? C.accent : 'transparent' }}>
                        <Text style={{ color: sex === s ? '#fff' : C.t3, fontWeight: '700', fontSize: 13 }}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: C.t3, fontWeight: '600', letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' }}>Units</Text>
                  <View style={{ flexDirection: 'row', backgroundColor: C.surface, borderRadius: 12, padding: 3 }}>
                    {[{ val: 'metric', label: 'kg/cm' }, { val: 'imperial', label: 'lbs/ft' }].map(u => (
                      <TouchableOpacity key={u.val} onPress={() => toggleUnits(u.val)}
                        style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: units === u.val ? C.s3 : 'transparent' }}>
                        <Text style={{ color: units === u.val ? C.t1 : C.t3, fontWeight: units === u.val ? '700' : '500', fontSize: 13 }}>{u.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>

              {/* Fields */}
              <View style={{ backgroundColor: C.surface, borderRadius: 14, overflow: 'hidden' }}>
                <View style={{ borderBottomWidth: 0.5, borderBottomColor: C.border }}>
                  <Text style={{ fontSize: 12, color: C.t3, fontWeight: '600', paddingHorizontal: 16, paddingTop: 12 }}>Age</Text>
                  <TextInput style={{ paddingHorizontal: 16, paddingBottom: 14, paddingTop: 4, color: C.t1, fontSize: 17, fontWeight: '600' }}
                    placeholder="25" placeholderTextColor={C.t3} value={age} onChangeText={setAge} keyboardType="numeric" />
                </View>
                <View style={{ borderBottomWidth: 0.5, borderBottomColor: C.border }}>
                  <Text style={{ fontSize: 12, color: C.t3, fontWeight: '600', paddingHorizontal: 16, paddingTop: 12 }}>Weight ({units === 'imperial' ? 'lbs' : 'kg'})</Text>
                  <TextInput style={{ paddingHorizontal: 16, paddingBottom: 14, paddingTop: 4, color: C.t1, fontSize: 17, fontWeight: '600' }}
                    placeholder={units === 'imperial' ? '165' : '75'} placeholderTextColor={C.t3} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
                </View>
                {units === 'metric' ? (
                  <View>
                    <Text style={{ fontSize: 12, color: C.t3, fontWeight: '600', paddingHorizontal: 16, paddingTop: 12 }}>Height (cm)</Text>
                    <TextInput style={{ paddingHorizontal: 16, paddingBottom: 14, paddingTop: 4, color: C.t1, fontSize: 17, fontWeight: '600' }}
                      placeholder="175" placeholderTextColor={C.t3} value={height} onChangeText={setHeight} keyboardType="decimal-pad" />
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row' }}>
                    <View style={{ flex: 1, borderRightWidth: 0.5, borderRightColor: C.border }}>
                      <Text style={{ fontSize: 12, color: C.t3, fontWeight: '600', paddingHorizontal: 16, paddingTop: 12 }}>Feet</Text>
                      <TextInput style={{ paddingHorizontal: 16, paddingBottom: 14, paddingTop: 4, color: C.t1, fontSize: 17, fontWeight: '600' }}
                        placeholder="5" placeholderTextColor={C.t3} value={height} onChangeText={setHeight} keyboardType="numeric" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, color: C.t3, fontWeight: '600', paddingHorizontal: 16, paddingTop: 12 }}>Inches</Text>
                      <TextInput style={{ paddingHorizontal: 16, paddingBottom: 14, paddingTop: 4, color: C.t1, fontSize: 17, fontWeight: '600' }}
                        placeholder="10" placeholderTextColor={C.t3} value={heightIn} onChangeText={setHeightIn} keyboardType="numeric" />
                    </View>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* ── Step 4 — Activity ── */}
          {step === 4 && (
            <View>
              <Text style={{ fontSize: 28, fontWeight: '800', color: '#fff', letterSpacing: -0.8, marginBottom: 6 }}>Activity level</Text>
              <Text style={{ fontSize: 15, color: C.t3, marginBottom: 24, fontWeight: '500', lineHeight: 22 }}>How active are you on a typical week?</Text>
              {activityOptions.map(opt => (
                <SelectCard key={opt.id} selected={activity === opt.id} onPress={() => setActivity(opt.id)} emoji={opt.emoji} label={opt.label} sub={opt.sub} />
              ))}
            </View>
          )}

          {/* ── Step 5 — Results ── */}
          {step === 5 && macros && (
            <View>
              <Text style={{ fontSize: 28, fontWeight: '800', color: '#fff', letterSpacing: -0.8, marginBottom: 6 }}>
                {firstName ? `You're all set, ${firstName}! 🎯` : "You're all set! 🎯"}
              </Text>
              <Text style={{ fontSize: 15, color: C.t3, marginBottom: 24, fontWeight: '500', lineHeight: 22 }}>Here are your personalised daily targets.</Text>

              <View style={{ backgroundColor: C.accent, borderRadius: 20, padding: 28, alignItems: 'center', marginBottom: 12,
                shadowColor: C.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 22 }}>
                <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>Daily Calories</Text>
                <Text style={{ fontSize: 64, fontWeight: '900', color: '#fff', letterSpacing: -3 }}>{macros.calories}</Text>
                <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', fontWeight: '600', marginTop: 4 }}>kcal / day</Text>
              </View>

              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 28 }}>
                {[
                  { label: 'Protein', emoji: '🥩', value: macros.protein, color: '#FF9F0A' },
                  { label: 'Carbs',   emoji: '🍚', value: macros.carbs,   color: '#30D158' },
                  { label: 'Fat',     emoji: '🥑', value: macros.fat,     color: '#FF6B6B' },
                ].map(m => (
                  <View key={m.label} style={{ flex: 1, backgroundColor: C.surface, borderRadius: 16, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: C.border }}>
                    <Text style={{ fontSize: 20, marginBottom: 4 }}>{m.emoji}</Text>
                    <Text style={{ fontSize: 22, fontWeight: '900', color: m.color, letterSpacing: -0.5 }}>{m.value}<Text style={{ fontSize: 12, fontWeight: '600', color: C.t3 }}>g</Text></Text>
                    <Text style={{ fontSize: 11, color: C.t3, fontWeight: '600', marginTop: 2, letterSpacing: 0.5 }}>{m.label.toUpperCase()}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

        </Animated.View>

        <View style={{ flex: 1 }} />

        {/* ── Navigation ── */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 24, paddingHorizontal: 24 }}>
          {step > 1 && (
            <TouchableOpacity onPress={() => setStep(step - 1)}
              style={{ flex: 1, borderRadius: 14, paddingVertical: 17, alignItems: 'center', backgroundColor: C.surface }}>
              <Text style={{ color: C.t2, fontSize: 16, fontWeight: '700' }}>Back</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={step === TOTAL_STEPS ? handleFinish : () => setStep(step + 1)}
            disabled={!canAdvance()}
            activeOpacity={0.84}
            style={{
              flex: 2, borderRadius: 14, paddingVertical: 17, alignItems: 'center',
              backgroundColor: canAdvance() ? C.accent : C.surface,
              opacity: canAdvance() ? 1 : 0.45,
              ...(canAdvance() ? { shadowColor: C.accent, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 16 } : {}),
            }}
          >
            <Text style={{ color: canAdvance() ? '#fff' : C.t3, fontSize: 17, fontWeight: '700', letterSpacing: -0.2 }}>
              {step === 1 ? "Let's go →" : step === TOTAL_STEPS ? 'Start Barbellz →' : 'Continue'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

// ── APP ──────────────────────────────────────────────────
export default function App() {
  const [session,         setSession]         = useState(undefined);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [themeKey,        setThemeKey]        = useState('grey');

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then(v => { if (v && THEMES[v]) setThemeKey(v); });
  }, []);

  const setTheme = useCallback(async (key) => {
    if (!THEMES[key]) return;
    await AsyncStorage.setItem(THEME_KEY, key);
    setThemeKey(key);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) { setSession(null); return; }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session ?? null);
      if (session) {
        AsyncStorage.getItem(ONBOARDING_KEY).then(v => setNeedsOnboarding(!v));
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session ?? null);
      if (!session) {
        setNeedsOnboarding(false);
      } else {
        AsyncStorage.getItem(ONBOARDING_KEY).then(v => setNeedsOnboarding(!v));
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const [showPaywall,   setShowPaywall]   = useState(false);
  const [showCalc,      setShowCalc]      = useState(false);
  const [trialDaysLeft, setTrialDaysLeft] = useState(TRIAL_DAYS);
  const [subscriptionActive, setSubscriptionActive] = useState(false);
  const [revenueCatReady, setRevenueCatReady] = useState(false);
  const [purchasePackages, setPurchasePackages] = useState([]);
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [purchaseLoading, setPurchaseLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    const loadAccess = async () => {
      const rcConfigured = isRevenueCatConfigured();
      setRevenueCatReady(rcConfigured);

      let activeSubscription = false;
      if (rcConfigured && Platform.OS === 'ios') {
        try {
          configureRevenueCat();
          const [access, packages] = await Promise.all([
            getCustomerAccess(),
            getPaywallPackages(),
          ]);
          activeSubscription = access.active;
          if (mounted) {
            setSubscriptionActive(access.active);
            setPurchasePackages(packages);
            setSelectedPackage(packages.find(p => String(p.packageType || '').toLowerCase().includes('annual')) || packages[0] || null);
          }
        } catch {
          if (mounted) {
            setPurchasePackages([]);
            setSelectedPackage(null);
          }
        }
      }

      const [[, trial]] = await AsyncStorage.multiGet([TRIAL_KEY]);
      if (!mounted) return;
      if (activeSubscription) {
        setShowPaywall(false);
        setTrialDaysLeft(TRIAL_DAYS);
        return;
      }

      let trialStart = trial;
      const parsedTrial = trialStart ? new Date(trialStart).getTime() : NaN;
      if (!trialStart || Number.isNaN(parsedTrial)) {
        trialStart = new Date().toISOString();
        await AsyncStorage.setItem(TRIAL_KEY, trialStart);
      }

      const daysPassed = Math.floor((Date.now() - new Date(trialStart).getTime()) / 86400000);
      const left = Math.max(0, TRIAL_DAYS - daysPassed);
      if (!mounted) return;
      setTrialDaysLeft(left);
      setShowPaywall(left <= 0);
    };
    loadAccess();
    return () => { mounted = false; };
  }, []);

  const handleSubscribe = async () => {
    if (!revenueCatReady || !selectedPackage) {
      Alert.alert('Subscription not ready', 'Add the RevenueCat iOS API key and configure your App Store products first.');
      return;
    }
    setPurchaseLoading(true);
    try {
      const result = await purchaseRevenueCatPackage(selectedPackage);
      setSubscriptionActive(result.active);
      setShowPaywall(!result.active);
      if (!result.active) Alert.alert('Subscription inactive', 'The purchase finished, but the Pro entitlement is not active yet.');
    } catch (e) {
      if (!e?.userCancelled) Alert.alert('Purchase failed', e?.message || 'Could not complete the purchase.');
    } finally {
      setPurchaseLoading(false);
    }
  };

  const handleRestorePurchases = async () => {
    if (!revenueCatReady) {
      Alert.alert('Restore not ready', 'Add the RevenueCat iOS API key first.');
      return;
    }
    setPurchaseLoading(true);
    try {
      const result = await restoreRevenueCatPurchases();
      setSubscriptionActive(result.active);
      setShowPaywall(!result.active && trialDaysLeft <= 0);
      Alert.alert(result.active ? 'Restored' : 'No active subscription', result.active ? 'Your Pro access is active.' : 'No active Pro subscription was found.');
    } catch (e) {
      Alert.alert('Restore failed', e?.message || 'Could not restore purchases.');
    } finally {
      setPurchaseLoading(false);
    }
  };

  if (session === undefined) {
    return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  }

  if (session === null) {
    return (
      <SafeAreaProvider>
        <AuthScreen onAuth={(isNew) => {
          if (isNew) setNeedsOnboarding(true);
        }} />
      </SafeAreaProvider>
    );
  }

  if (needsOnboarding) {
    return (
      <SafeAreaProvider>
        <OnboardingScreen onDone={() => setNeedsOnboarding(false)} />
      </SafeAreaProvider>
    );
  }

  const rerunOnboarding = async () => {
    await AsyncStorage.removeItem(ONBOARDING_KEY);
    setNeedsOnboarding(true);
  };

  return (
    <ThemeContext.Provider value={THEMES[themeKey]}>
    <AppActionsContext.Provider value={{ rerunOnboarding, setTheme, themeKey, subscriptionActive, trialDaysLeft, setShowPaywall }}>
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      {/* Pre-render sprite sheet off-screen so GPU decodes it at app launch, not on first open */}
      <View style={{ position:'absolute', width:1, height:1, overflow:'hidden', opacity:0 }} pointerEvents="none">
        <Image source={MUSCLE_SPRITE_SRC} style={{ width: SPRITE_W, height: SPRITE_H }} />
      </View>
      <NavigationContainer theme={{
        dark: themeKey !== 'light',
        colors: {
          primary:      THEMES[themeKey].accent,
          background:   THEMES[themeKey].bg,
          card:         THEMES[themeKey].surface,
          text:         THEMES[themeKey].t1,
          border:       THEMES[themeKey].border,
          notification: THEMES[themeKey].accent,
        },
      }}>
        <Tab.Navigator
          tabBar={props => <FloatingTabBar {...props} />}
          screenOptions={{ headerShown: false, lazy: false }}
          detachInactiveScreens={false}
        >
          <Tab.Screen name="Home"      component={HomeScreen}      options={{ tabBarIcon: ({ focused, color }) => <PremiumTabIcon focused={focused} color={color} activeIcon="home" icon="home-outline" /> }} />
          <Tab.Screen name="Nutrition" component={NutritionScreen} options={{ tabBarIcon: ({ focused, color }) => <PremiumTabIcon focused={focused} color={color} activeIcon="restaurant" icon="restaurant-outline" /> }} />
          <Tab.Screen name="Workout"   component={WorkoutScreen}   options={{ tabBarIcon: ({ focused, color }) => <PremiumTabIcon focused={focused} color={color} activeIcon="barbell" icon="barbell-outline" /> }} />
          <Tab.Screen name="Progress"  component={ProgressScreen}  options={{ tabBarIcon: ({ focused, color }) => <PremiumTabIcon focused={focused} color={color} activeIcon="stats-chart" icon="stats-chart-outline" /> }} />
          <Tab.Screen name="Profile"   component={ProfileScreen}   options={{ tabBarIcon: ({ focused, color }) => <PremiumTabIcon focused={focused} color={color} activeIcon="person" icon="person-outline" /> }} />
        </Tab.Navigator>
      </NavigationContainer>

      <CalorieCalculatorModal
        visible={showCalc}
        onClose={() => setShowCalc(false)}
        onSave={async (goals) => {
          await AsyncStorage.setItem(GOALS_KEY, JSON.stringify(goals));
          setShowCalc(false);
        }}
      />

      <PaywallModal
        visible={showPaywall}
        daysLeft={trialDaysLeft}
        packages={purchasePackages}
        selectedPackage={selectedPackage}
        onSelectPackage={setSelectedPackage}
        onSubscribe={handleSubscribe}
        onRestore={handleRestorePurchases}
        onClose={() => { if (trialDaysLeft > 0 || subscriptionActive) setShowPaywall(false); }}
        loading={purchaseLoading}
        configured={revenueCatReady}
      />

    </SafeAreaProvider>
    </GestureHandlerRootView>
    </AppActionsContext.Provider>
    </ThemeContext.Provider>
  );
}

// ── STYLES ────────────────────────────────────────────────
function mkStyles(C) { return StyleSheet.create({
  screen:  { flex: 1, backgroundColor: C.bg },
  center:  { alignItems: 'center', justifyContent: 'center' },
  scroll:  { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerTitle: { fontSize: 28, fontWeight: '800', color: C.t1, letterSpacing: -0.8 },
  headerSub:   { fontSize: 13, color: C.t3, marginTop: 2, fontWeight: '500' },

  streakBadge: {
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    gap: 1,
  },
  streakNum: { fontSize: 22, fontWeight: '900', color: '#fff', letterSpacing: -0.5, lineHeight: 26 },
  streakLbl: { fontSize: 8,  fontWeight: '800', color: 'rgba(255,255,255,0.8)', letterSpacing: 1 },

  heroCard: {
    backgroundColor: C.accent,
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroLabel: { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.7)', letterSpacing: 1.5, marginBottom: 4 },
  heroTitle: { fontSize: 24, fontWeight: '900', color: '#fff', letterSpacing: -0.5 },
  heroSub:   { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 3, fontWeight: '500' },
  heroBtn: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  heroBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },

  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  cardLabel: { fontSize: 10, fontWeight: '800', color: C.t3, letterSpacing: 1.5, marginBottom: 14 },

  calRow:    { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  calMain:   { flex: 1, alignItems: 'center' },
  calNum:    { fontSize: 32, fontWeight: '900', color: C.t1, letterSpacing: -1 },
  calUnit:   { fontSize: 11, color: C.t3, fontWeight: '600', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  calDivider:{ width: 1, height: 40, backgroundColor: C.border },

  macroList: { gap: 10 },
  macroRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  macroName: { fontSize: 12, fontWeight: '600', color: C.t2, width: 52 },
  macroTrack:{ flex: 1, height: 4, backgroundColor: C.s3, borderRadius: 2, overflow: 'hidden' },
  macroFill: { height: '100%', borderRadius: 2 },
  macroVal:  { fontSize: 12, color: C.t2, fontWeight: '600', width: 36, textAlign: 'right' },

  secondaryBtn: {
    marginHorizontal: 16,
    marginBottom: 20,
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  secondaryBtnText: { fontSize: 15, fontWeight: '700', color: C.accent },

  sectionTitle: { fontSize: 18, fontWeight: '800', color: C.t1, letterSpacing: -0.3, marginHorizontal: 20, marginBottom: 8 },

  row:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 13 },
  rowBorder: { borderBottomWidth: 0.5, borderBottomColor: C.border },
  rowTitle:  { fontSize: 15, fontWeight: '600', color: C.t1 },
  rowSub:    { fontSize: 12, color: C.t3, marginTop: 2 },
  rowValue:  { fontSize: 20, fontWeight: '800', color: C.accent, letterSpacing: -0.5 },

  statsRow: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginBottom: 12 },
  statChip: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  statVal: { fontSize: 16, fontWeight: '800', color: C.t1, letterSpacing: -0.5 },
  statLbl: { fontSize: 9, color: C.t3, fontWeight: '700', marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.4 },

  placeholder:    { fontSize: 22, fontWeight: '800', color: C.t1 },
  placeholderSub: { fontSize: 14, color: C.t3, marginTop: 6, fontWeight: '500' },
}); }

function mkNutStyles(C) { return StyleSheet.create({
  // Top header
  topBar:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.surface, borderBottomWidth: 0.5, borderBottomColor: C.border },
  topBack:    { fontSize: 26, color: C.t1, fontWeight: '300', width: 40 },
  topTitle:   { fontSize: 17, color: C.t1 },
  topAction:  { fontSize: 14, color: C.accent, width: 60, textAlign: 'right' },
  topLeftAction: { fontSize: 14, color: C.accent, minWidth: 86 },

  // Tabs
  tabBar:         { flexDirection: 'row', backgroundColor: C.surface, borderBottomWidth: 0.5, borderBottomColor: C.border },
  tabItem:        { flex: 1, alignItems: 'center', paddingVertical: 13 },
  tabText:        { fontSize: 13, color: C.t3 },
  tabTextActive:  { color: C.t1 },
  tabUnderline:   { position: 'absolute', bottom: 0, left: '15%', right: '15%', height: 2, backgroundColor: C.accent, borderRadius: 1 },

  // Date nav
  dateBar:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 10, backgroundColor: C.surface, borderBottomWidth: 0.5, borderBottomColor: C.border },
  dateChevron:   { fontSize: 22, color: C.t2, fontWeight: '300' },
  datePill:      { minWidth: 140, alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  dateViewRow:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dateViewLabel: { fontSize: 11, color: C.t3, textAlign: 'center' },
  dateText:      { fontSize: 18, fontWeight: '800', color: C.t1, textAlign: 'center', letterSpacing: -0.3 },

  // Floating card
  card: { backgroundColor: C.surface, marginHorizontal: 12, borderRadius: 16, marginBottom: 12, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 10, elevation: 5 },

  // Calories block
  block:         { paddingHorizontal: 16, paddingVertical: 14 },
  blockTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  blockTitle:    { fontSize: 14, color: C.t1 },
  formula:       { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  formulaItem:   { alignItems: 'center', gap: 4 },
  formulaNum:    { fontSize: 17, color: C.t1 },
  formulaLbl:    { fontSize: 11, color: C.t3 },
  formulaOp:     { fontSize: 17, color: C.t3, fontWeight: '300', paddingBottom: 16 },

  // Separators
  sep:      { height: 0.5, backgroundColor: C.border },
  thickSep: { height: 0, backgroundColor: 'transparent' },

  // Diary
  mealHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13 },
  mealName:   { fontSize: 15, color: C.t1, fontWeight: '700' },
  mealCal:    { fontSize: 13, color: C.t3 },
  foodRow:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  foodRowSelected: { backgroundColor: 'rgba(10,132,255,0.12)' },
  selectCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: C.s3, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  selectCircleActive: { backgroundColor: C.accent, borderColor: C.accent },
  foodName:   { fontSize: 14, color: C.t1 },
  foodSub:    { fontSize: 11, color: C.t3, marginTop: 2 },
  addRow:     { flexDirection: 'row', alignItems: 'stretch', borderTopWidth: 0.5, borderTopColor: C.border },
  addText:    { fontSize: 13, fontWeight: '700', color: C.accent },
  bulkBar: { position: 'absolute', left: 18, right: 18, bottom: 98, minHeight: 58, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(44,44,46,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', paddingHorizontal: 16, paddingVertical: 9, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 14, elevation: 18 },
  bulkCount: { fontSize: 15, color: C.t2, fontWeight: '700' },
  bulkActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bulkDeleteBtn: { minWidth: 110, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FF375F', borderRadius: 14, paddingHorizontal: 18 },
  bulkDeleteText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  bulkCancelBtn: { height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: C.s2, borderRadius: 14, paddingHorizontal: 18 },
  bulkCancelText: { color: C.t1, fontSize: 16, fontWeight: '600' },
  toast: { position: 'absolute', bottom: 96, alignSelf: 'center', zIndex: 999, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(44,44,46,0.96)', borderRadius: 22, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 16, paddingVertical: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 20 },
  toastText: { color: C.t1, fontSize: 14, fontWeight: '700' },

  // Nutrients tab
  colHeader:      { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.bg },
  colLbl:         { fontSize: 12, color: C.t3, width: 54, textAlign: 'right' },
  nutriRow:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 15, gap: 6 },
  nutriName:      { fontSize: 14, color: C.t1, marginBottom: 4 },
  nutriBarTrack:  { height: 4, backgroundColor: C.s3, borderRadius: 2, overflow: 'hidden', marginTop: 2, alignSelf: 'stretch' },
  nutriBarFill:   { height: '100%', borderRadius: 2 },
  nutriVal:       { fontSize: 13, color: C.t3, width: 54, textAlign: 'right' },

  // Macros tab — rings
  ringsRow:   { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 32, paddingHorizontal: 8 },
  ringWrap:   { alignItems: 'center', gap: 8 },
  ringTrack:  { width: 96, height: 96, borderRadius: 48, borderWidth: 8, position: 'absolute' },
  ringCenter: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  ringVal:    { fontSize: 18, letterSpacing: -0.5 },
  ringGoal:   { fontSize: 10, color: C.t3, marginTop: 1 },
  ringName:   { fontSize: 13, color: C.t1 },
  ringLeft:   { fontSize: 11, color: C.t3 },

  // Calorie breakdown
  calBreakRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  calBreakLbl: { fontSize: 14, color: C.t1 },
  calBreakVal: { fontSize: 14, color: C.t2 },
  dot:         { width: 10, height: 10, borderRadius: 5 },

}); }

function mkAfStyles(C) { return StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },

  // Header
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  back:       { fontSize: 24, color: C.t1, fontWeight: '300', width: 28 },
  mealPicker: { alignItems: 'center' },
  mealName:   { fontSize: 16, color: C.accent, fontWeight: '600' },

  // Search — outline pill
  searchWrap:  { flexDirection: 'row', alignItems: 'center', borderRadius: 22, borderWidth: 1, borderColor: C.s3, marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 9, gap: 8 },
  searchIcon:  { fontSize: 13 },
  searchInput: { flex: 1, fontSize: 14, color: C.t1 },

  // Filter tabs
  tabsScroll:      { flexGrow: 0 },
  tabsContent:     { paddingHorizontal: 10 },
  filterTab:       { paddingHorizontal: 12, paddingVertical: 8 },
  filterTabText:   { fontSize: 13, color: C.t3 },
  filterTabActive: { color: C.t1, fontWeight: '600' },
  filterUnderline: { position: 'absolute', bottom: 0, left: 12, right: 12, height: 2, backgroundColor: C.accent },

  sep: { height: 0.5, backgroundColor: C.border },

  // Action buttons — 4 in a row
  actionRow:   { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  actionTile:  { flex: 1, backgroundColor: C.s2, borderRadius: 10, paddingVertical: 10, alignItems: 'center', gap: 5 },
  actionIcon:  { fontSize: 17, color: C.accent },
  actionLabel: { fontSize: 10, color: C.accent, textAlign: 'center' },

  // History
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  historyTitle:  { fontSize: 16, color: C.t1, fontWeight: '700' },
  sortBtn:       { flexDirection: 'row', alignItems: 'center', backgroundColor: C.s2, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5, gap: 4 },
  sortText:      { fontSize: 12, color: C.t1 },

  // Food cards
  foodCard:      { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 10, borderWidth: 0.5, borderColor: C.s3, marginHorizontal: 16, marginBottom: 7, paddingHorizontal: 12, paddingVertical: 11, gap: 10 },
  foodName:      { fontSize: 13, color: C.t1 },
  foodSub:       { fontSize: 11, color: C.t3, marginTop: 3 },
  circleAdd:     { width: 30, height: 30, borderRadius: 15, backgroundColor: C.s2, borderWidth: 1.5, borderColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  circleAddText: { fontSize: 20, color: C.accent, lineHeight: 23, marginTop: -1 },
  quickToast:    { position: 'absolute', bottom: 38, alignSelf: 'center', zIndex: 260, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(44,44,46,0.96)', borderRadius: 22, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 16, paddingVertical: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 20 },
  quickToastText:{ color: C.t1, fontSize: 14, fontWeight: '700' },

  // Bottom banner
  banner:      { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: C.s2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 13, gap: 8, borderTopWidth: 0.5, borderTopColor: C.s3 },
  bannerText:  { fontSize: 14, color: C.t1 },
  bannerArrow: { fontSize: 16, color: C.t1 },

  empty: { fontSize: 13, color: C.t3, textAlign: 'center', paddingTop: 40 },

  // Restaurants
  restCatLabel:  { fontSize: 11, fontWeight: '700', color: C.t3, textTransform: 'uppercase', letterSpacing: 0.8, marginHorizontal: 16, marginTop: 18, marginBottom: 6 },
  restRow:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 0.5, borderBottomColor: C.border, gap: 12 },
  restIcon:      { width: 38, height: 38, borderRadius: 10, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center' },
  restName:      { fontSize: 14, fontWeight: '600', color: C.t1 },
  restCount:     { fontSize: 11, color: C.t3, marginTop: 2 },
  restBackRow:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  restBackText:  { fontSize: 14, color: C.accent },
  restMenuTitle: { fontSize: 17, fontWeight: '700', color: C.t1, paddingHorizontal: 16, paddingBottom: 8 },

  // Create food form
  createField:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: C.border },
  createLabel:   { fontSize: 14, color: C.t1 },
  createInput:   { fontSize: 14, color: C.t1, textAlign: 'right', minWidth: 100 },
  createDivider: { height: 8, backgroundColor: C.sep, marginVertical: 8, marginHorizontal: -16 },
  saveBtn:       { backgroundColor: C.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 24 },
  saveBtnText:   { fontSize: 15, fontWeight: '700', color: '#fff' },
}); }

// ── WORKOUT STYLES ────────────────────────────────────────
function mkWkStyles(C) { return StyleSheet.create({
  // ── Main screen ──
  header:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  title:             { fontSize: 28, fontWeight: '800', color: C.t1, letterSpacing: -0.8 },
  historyBtn:        { fontSize: 14, color: C.accent, fontWeight: '600' },
  startBtn:          { backgroundColor: C.accent, borderRadius: 12, marginHorizontal: 16, marginBottom: 24, paddingVertical: 15, alignItems: 'center' },
  startBtnText:      { fontSize: 16, fontWeight: '700', color: '#fff' },
  sectionTitle:      { fontSize: 13, fontWeight: '700', color: C.t3, letterSpacing: 0.8, textTransform: 'uppercase', marginHorizontal: 16, marginBottom: 10 },
  sectionRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 16, marginBottom: 10 },
  sectionAction:     { fontSize: 14, color: C.accent, fontWeight: '600' },
  routineCard:       { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, marginHorizontal: 16, marginBottom: 10, borderRadius: 12, padding: 16, gap: 12 },
  routineName:       { fontSize: 16, fontWeight: '700', color: C.t1, marginBottom: 4 },
  routineExercises:  { fontSize: 12, color: C.t3, marginBottom: 4 },
  routineMeta:       { fontSize: 12, color: C.t3 },
  startSmallBtn:     { backgroundColor: C.s2, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: C.accent },
  startSmallBtnText: { fontSize: 13, fontWeight: '700', color: C.accent },
  recentCard:        { backgroundColor: C.surface, marginHorizontal: 16, marginBottom: 10, borderRadius: 12, padding: 16 },
  recentName:        { fontSize: 15, fontWeight: '700', color: C.t1 },
  recentDate:        { fontSize: 13, color: C.t3 },
  recentLifts:       { fontSize: 13, color: C.t2, marginBottom: 4 },
  recentMeta:        { fontSize: 12, color: C.t3 },
  emptyBox:          { marginHorizontal: 16, marginBottom: 10, paddingVertical: 24, alignItems: 'center' },
  emptyText:         { fontSize: 14, color: C.t3, textAlign: 'center' },

  // ── Active workout screen ──
  activeScreen:      { flex: 1, backgroundColor: C.bg },
  activeHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: C.border },
  activeName:        { fontSize: 15, fontWeight: '700', color: C.t1 },
  activeTimer:       { fontSize: 13, color: C.accent, fontWeight: '600', textAlign: 'center', marginTop: 2 },
  finishSmallBtn:    { backgroundColor: C.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  finishSmallBtnText:{ fontSize: 13, fontWeight: '700', color: '#fff' },

  // ── Exercise card ──
  exCard:            { backgroundColor: C.surface, marginHorizontal: 16, marginBottom: 12, borderRadius: 12, overflow: 'hidden' },
  exHeader:          { flexDirection: 'row', alignItems: 'center', padding: 14, paddingBottom: 8 },
  exName:            { fontSize: 15, fontWeight: '700', color: C.t1, marginBottom: 2 },
  exMeta:            { fontSize: 12, color: C.t3 },

  // ── Set rows ──
  setHeader:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 6, gap: 4 },
  setHeaderCell:     { fontSize: 11, fontWeight: '700', color: C.t3, letterSpacing: 0.5 },
  setRow:            { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, gap: 4 },
  setRowDone:        { backgroundColor: 'rgba(48,209,88,0.08)' },
  setNum:            { width: 28, fontSize: 13, fontWeight: '700', color: C.t3 },
  setPrev:           { flex: 1, fontSize: 12, color: C.t3 },
  setInput:          { width: 64, backgroundColor: C.s2, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 7, fontSize: 14, fontWeight: '600', color: C.t1, textAlign: 'center' },
  setCheck:          { width: 32, height: 32, borderRadius: 8, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center' },
  setCheckDone:      { backgroundColor: '#30D158' },
  addSetBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderTopWidth: 0.5, borderTopColor: C.border },
  addSetText:        { fontSize: 14, fontWeight: '600', color: C.accent },

  // ── Add exercise button ──
  addExBtn:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginHorizontal: 16, marginTop: 8, marginBottom: 16, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: C.accent, borderStyle: 'dashed' },
  addExText:         { fontSize: 15, fontWeight: '600', color: C.accent },

  // ── Finish summary ──
  finishWrap:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  finishTitle:       { fontSize: 24, fontWeight: '800', color: C.t1, letterSpacing: -0.5, marginTop: 16, textAlign: 'center' },
  finishSub:         { fontSize: 15, color: C.t3, marginTop: 6, marginBottom: 32 },
  finishStats:       { flexDirection: 'row', gap: 24, marginBottom: 40 },
  finishStat:        { alignItems: 'center' },
  finishStatVal:     { fontSize: 26, fontWeight: '800', color: C.t1, letterSpacing: -0.5 },
  finishStatLbl:     { fontSize: 12, color: C.t3, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  finishBtn:         { backgroundColor: C.accent, borderRadius: 14, paddingHorizontal: 48, paddingVertical: 16, alignItems: 'center' },
  finishBtnText:     { fontSize: 16, fontWeight: '700', color: '#fff' },

  // ── Picker / History / Builder screens ──
  pickerScreen:      { flex: 1, backgroundColor: C.bg },
  pickerHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: C.border },
  pickerCancel:      { fontSize: 15, color: C.accent, width: 60 },
  pickerTitle:       { fontSize: 17, fontWeight: '700', color: C.t1 },
  saveBtn:           { fontSize: 15, fontWeight: '700', color: C.accent, width: 60, textAlign: 'right' },
  pickerSearch:      { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.surface, marginHorizontal: 12, marginTop: 10, marginBottom: 4, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  pickerSearchInput: { flex: 1, fontSize: 15, color: C.t1 },

  // ── Muscle filter chips ──
  muscleChip:         { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: C.surface },
  muscleChipActive:   { backgroundColor: C.accent },
  muscleChipText:     { fontSize: 13, fontWeight: '600', color: C.t2 },
  muscleChipTextActive:{ color: '#fff' },

  // ── Exercise list rows ──
  exerciseRow:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12, borderBottomWidth: 0.5, borderBottomColor: C.border },
  exerciseIcon:      { width: 36, height: 36, borderRadius: 10, backgroundColor: C.s2, alignItems: 'center', justifyContent: 'center' },
  exerciseName:      { fontSize: 15, fontWeight: '600', color: C.t1, marginBottom: 2 },
  exerciseSub:       { fontSize: 12, color: C.t2 },

  // ── Routine builder ──
  builderNameInput:  { fontSize: 18, fontWeight: '700', color: C.t1, borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 10 },
  builderExRow:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12, borderBottomWidth: 0.5, borderBottomColor: C.border },
}); }

// ── PROGRESS STYLES ───────────────────────────────────────
function mkPgStyles(C) { return StyleSheet.create({
  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  title:        { fontSize: 28, fontWeight: '800', color: C.t1, letterSpacing: -0.8 },
  tabBar:       { flexDirection: 'row', backgroundColor: C.surface, borderBottomWidth: 0.5, borderBottomColor: C.border },
  tab:          { flex: 1, alignItems: 'center', paddingVertical: 11 },
  tabText:      { fontSize: 13, color: C.t3 },
  tabActive:    { color: C.t1 },
  tabUnderline: { position: 'absolute', bottom: 0, left: '15%', right: '15%', height: 2, backgroundColor: C.accent, borderRadius: 1 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: C.t3, letterSpacing: 0.8, textTransform: 'uppercase', marginHorizontal: 16, marginTop: 20, marginBottom: 10 },
  card:         { backgroundColor: C.surface, marginHorizontal: 16, borderRadius: 12, overflow: 'hidden' },
  row:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  rowBorder:    { borderBottomWidth: 0.5, borderBottomColor: C.border },
  rowLabel:     { fontSize: 14, color: C.t1 },
  rowVal:       { fontSize: 15, fontWeight: '700', color: C.t1 },
  chartCard:    { backgroundColor: C.surface, marginHorizontal: 16, marginTop: 16, borderRadius: 12, padding: 16 },
  chartHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chartTitle:   { fontSize: 15, fontWeight: '700', color: C.t1 },
  chartCurrent: { fontSize: 22, fontWeight: '800', color: C.accent, letterSpacing: -0.5 },
  chartSub:     { fontSize: 12, color: '#30D158', marginBottom: 16, marginTop: 2 },
  barsWrap:     { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 90 },
  barCol:       { alignItems: 'center', gap: 4, flex: 1 },
  bar:          { width: 22, backgroundColor: C.accent, borderRadius: 4, opacity: 0.85 },
  barLbl:       { fontSize: 10, color: C.t3 },
  statsGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16, paddingTop: 16 },
  statBox:      { width: '47%', backgroundColor: C.surface, borderRadius: 12, padding: 14 },
  statVal:      { fontSize: 22, fontWeight: '800', color: C.t1, letterSpacing: -0.5 },
  statLbl:      { fontSize: 11, color: C.t3, marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.4 },
  freqCard:     { flexDirection: 'row', backgroundColor: C.surface, marginHorizontal: 16, borderRadius: 12, padding: 16, justifyContent: 'space-between' },
  freqCol:      { alignItems: 'center', gap: 6 },
  freqBar:      { width: 28, height: 28, borderRadius: 8, backgroundColor: C.s2 },
  freqBarDone:  { backgroundColor: C.accent },
  freqDay:      { fontSize: 11, color: C.t3 },
}); }

// ── PROFILE STYLES ────────────────────────────────────────
function mkPrfStyles(C) { return StyleSheet.create({
  floatCard:    {
    backgroundColor: C.surface,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.11,
    shadowRadius: 18,
    elevation: 6,
  },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: C.t3, letterSpacing: 1.1, textTransform: 'uppercase', marginHorizontal: 16, marginTop: 22, marginBottom: 10 },
  card:         { backgroundColor: C.surface, marginHorizontal: 16, borderRadius: 18, overflow: 'hidden' },
  row:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 13 },
  rowLabel:     { fontSize: 14, color: C.t1 },
  rowVal:       { fontSize: 14, color: C.t3 },
}); }

// ── BARCODE SCANNER STYLES ────────────────────────────────
function mkBsStyles(C) { return StyleSheet.create({
  screen:      { flex: 1, backgroundColor: '#000' },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#000' },
  cancel:      { fontSize: 16, color: C.accent },
  title:       { fontSize: 16, color: '#fff', fontWeight: '600' },
  camera:      { flex: 1 },
  overlay:     { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  scanFrame:   { width: 240, height: 160, borderWidth: 2, borderColor: C.accent, borderRadius: 12, backgroundColor: 'transparent' },
  hint:        { marginTop: 20, fontSize: 14, color: '#fff', opacity: 0.8 },
  permWrap:    { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, backgroundColor: C.bg },
  permTitle:   { fontSize: 20, fontWeight: '700', color: C.t1, marginBottom: 8 },
  permSub:     { fontSize: 14, color: C.t3, textAlign: 'center', marginBottom: 24 },
  permBtn:     { backgroundColor: C.accent, borderRadius: 12, paddingHorizontal: 32, paddingVertical: 14 },
  permBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  resultWrap:  { flex: 1, backgroundColor: C.bg, padding: 14 },
  headerIconBtn:{ width: 60, alignItems: 'flex-end' },
  matchBanner: { backgroundColor: 'rgba(10,132,255,0.16)', marginHorizontal: -14, marginBottom: 14, paddingHorizontal: 14, paddingVertical: 10 },
  matchText:   { fontSize: 12, color: C.t2 },
  matchLink:   { fontSize: 13, color: C.accent, marginTop: 2, fontWeight: '600' },
  reviewHeader:{ paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: C.border },
  reviewName:  { fontSize: 23, fontWeight: '800', color: C.t1, letterSpacing: -0.2, lineHeight: 29 },
  reviewBrand: { fontSize: 13, color: C.t3, marginTop: 5, lineHeight: 18 },
  formRows:    { borderBottomWidth: 0.5, borderBottomColor: C.border },
  formRow:     { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  formLabel:   { flex: 1, fontSize: 16, color: C.t1, opacity: 0.86 },
  formValueBox:{ minWidth: 104, maxWidth: 168, minHeight: 42, borderRadius: 8, borderWidth: 1, borderColor: C.s3, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: 11 },
  formValue:   { fontSize: 16, color: C.accent, fontWeight: '600' },
  servingsInput:{ minWidth: 82, height: 42, borderRadius: 8, borderWidth: 1, borderColor: C.s3, color: C.accent, textAlign: 'right', paddingHorizontal: 12, fontSize: 16, fontWeight: '600' },
  nutritionSummary:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 20, gap: 10 },
  ringCalories:{ fontSize: 20, fontWeight: '800', color: C.t1, letterSpacing: -0.3 },
  ringUnit:    { fontSize: 11, color: C.t2, marginTop: -2 },
  reviewMacro:{ flex: 1, alignItems: 'center' },
  reviewMacroPct:{ fontSize: 13, fontWeight: '800', marginBottom: 5 },
  reviewMacroVal:{ fontSize: 18, fontWeight: '700', color: C.t1, marginBottom: 2 },
  reviewMacroLbl:{ fontSize: 12, color: C.t2 },
  sponsorSpace:{ minHeight: 190, borderTopWidth: 0.5, borderTopColor: C.border, marginTop: 16 },
  pickerBackdrop:{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  pickerSheet: { backgroundColor: C.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 38 },
  pickerHandle:{ width: 36, height: 4, borderRadius: 2, backgroundColor: C.s3, alignSelf: 'center', marginTop: 10, marginBottom: 10 },
  pickerTitle: { fontSize: 17, fontWeight: '700', color: C.t1, paddingHorizontal: 20, paddingBottom: 8 },
  pickerRow:   { minHeight: 56, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 0.5, borderTopColor: C.border },
  pickerRowText:{ fontSize: 16, color: C.t1 },
  foodCard:    { backgroundColor: C.surface, borderRadius: 14, padding: 18, marginBottom: 16 },
  foodName:    { fontSize: 18, fontWeight: '700', color: C.t1, marginBottom: 4 },
  foodBrand:   { fontSize: 13, color: C.t3, marginBottom: 4 },
  foodServing: { fontSize: 12, color: C.t3, marginBottom: 16 },
  macroRow:    { flexDirection: 'row', justifyContent: 'space-between' },
  macroItem:   { alignItems: 'center', flex: 1 },
  macroVal:    { fontSize: 20, fontWeight: '800', color: C.t1 },
  macroLbl:    { fontSize: 11, color: C.t3, marginTop: 2 },
  addBtn:      { backgroundColor: C.accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginBottom: 10 },
  addBtnText:  { fontSize: 14, fontWeight: '700', color: '#fff' },
  scanAgain:   { paddingVertical: 14, alignItems: 'center' },
  scanAgainText:{ fontSize: 14, color: C.accent },
}); }

// ── LABEL SCANNER STYLES ──────────────────────────────────
function mkLsStyles(C) { return StyleSheet.create({
  screen:          { flex: 1, backgroundColor: '#000' },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#000' },
  cancel:          { fontSize: 16, color: C.accent },
  title:           { fontSize: 16, color: '#fff', fontWeight: '600' },
  camera:          { flex: 1 },
  overlay:         { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  labelFrame:      { width: 300, height: 200, borderWidth: 2, borderColor: C.accent, borderRadius: 8 },
  hint:            { marginTop: 16, fontSize: 13, color: '#fff', opacity: 0.8 },
  captureRow:      { position: 'absolute', bottom: 48, left: 0, right: 0, alignItems: 'center' },
  captureBtn:      { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  captureBtnInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  processingText:  { color: '#fff', fontSize: 13, marginTop: 12, opacity: 0.8 },
}); }

// ── MEAL DETAIL BOTTOM SHEET STYLES ──────────────────────
function mkMdStyles(C) { return StyleSheet.create({
  modalWrap:   { flex: 1, justifyContent: 'flex-end' },
  backdrop:    { flex: 1 },
  sheet:       { backgroundColor: C.s2, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40, shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.5, shadowRadius: 16, elevation: 20 },
  dragArea:    { paddingTop: 12, paddingBottom: 8, alignItems: 'center' },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: C.s3 },
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 14 },
  title:       { fontSize: 18, fontWeight: '700', color: C.t1 },
  calTotal:    { fontSize: 36, fontWeight: '900', color: C.t1, letterSpacing: -1, textAlign: 'center' },
  calUnit:     { fontSize: 15, fontWeight: '400', color: C.t3 },
  ringsRow:    { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 24, paddingHorizontal: 8 },
  ringWrap:    { alignItems: 'center', gap: 8 },
  ringTrack:   { width: 80, height: 80, borderRadius: 40, borderWidth: 7, position: 'absolute' },
  ringCenter:  { width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  ringVal:     { fontSize: 15, fontWeight: '700', letterSpacing: -0.3 },
  ringGoal:    { fontSize: 10, color: C.t3, marginTop: 1 },
  ringName:    { fontSize: 12, color: C.t2 },
  sep:         { height: 0.5, backgroundColor: C.border, marginHorizontal: 20, marginBottom: 4 },
  itemsScroll: { maxHeight: 280 },
  itemRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  itemBorder:  { borderBottomWidth: 0.5, borderBottomColor: C.border },
  itemName:    { fontSize: 14, color: C.t1, flex: 1 },
  itemMacros:  { fontSize: 11, color: C.t3, marginRight: 12 },
  itemCal:     { fontSize: 14, color: C.t2, fontWeight: '600', minWidth: 36, textAlign: 'right' },
  empty:       { fontSize: 14, color: C.t3, textAlign: 'center', paddingVertical: 24 },
}); }

// ── AI MEAL SCAN STYLES ───────────────────────────────────
function mkMsStyles(C) { return StyleSheet.create({
  resultsTitle: { fontSize: 16, fontWeight: '700', color: C.t1, marginBottom: 14 },
  foodList:     { flex: 1, marginBottom: 16 },
  foodRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 0.5, borderBottomColor: C.border },
  foodName:     { fontSize: 14, color: C.t1, marginBottom: 3 },
  foodSub:      { fontSize: 11, color: C.t3 },
  foodCal:      { fontSize: 16, fontWeight: '700', color: C.t1 },
  calUnit:      { fontSize: 11, fontWeight: '400', color: C.t3 },
  plateFrame:   { width: 280, height: 280, borderRadius: 140, borderWidth: 2, borderColor: C.accent, borderStyle: 'dashed' },
  uploadBtn:    { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
}); }

// ── DATE PICKER STYLES ────────────────────────────────────
function mkDpStyles(C) { return StyleSheet.create({
  modalWrap:{ flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.58)' },
  sheet:    { backgroundColor: C.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 28, shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.45, shadowRadius: 14, elevation: 20 },
  handle:   { width: 36, height: 4, borderRadius: 2, backgroundColor: C.s3, alignSelf: 'center', marginTop: 9, marginBottom: 0 },
  pickerHeader: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, borderBottomWidth: 0.5, borderBottomColor: C.border },
  title:    { fontSize: 17, fontWeight: '800', color: C.t1, textAlign: 'center' },
  todayLink: { alignSelf: 'center', paddingHorizontal: 20, paddingTop: 15, paddingBottom: 4 },
  todayLinkText: { color: C.accent, fontSize: 15, fontWeight: '700' },
  wheelWrap: { flexDirection: 'row', marginHorizontal: 18, marginTop: 2, overflow: 'hidden' },
  wheelDayCol: { flex: 0.8 },
  wheelMonthCol: { flex: 1.25 },
  wheelYearCol: { flex: 1 },
  wheelSelection: { position: 'absolute', left: 0, right: 0, top: 76, height: 38, borderRadius: 18, backgroundColor: C.s2, borderWidth: 0.5, borderColor: C.border },
  wheelItem: { height: 38, alignItems: 'center', justifyContent: 'center' },
  wheelText: { fontSize: 18, fontWeight: '700', color: C.t3 },
  wheelTextActive: { fontSize: 24, color: C.t1, fontWeight: '600' },
}); }

// ── SERVING PICKER / EDIT SHEET STYLES ───────────────────
function mkSsStyles(C) { return StyleSheet.create({
  modalWrap:    { flex: 1, justifyContent: 'flex-end' },
  backdrop:     { flex: 1 },
  sheet:        { backgroundColor: C.s2, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingBottom: 40, maxHeight: '72%', shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.5, shadowRadius: 16, elevation: 20 },
  dragArea:     { paddingTop: 12, paddingBottom: 8, alignItems: 'center' },
  handle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: C.s3 },
  headerRow:    { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 12 },
  title:        { fontSize: 18, fontWeight: '700', color: C.t1 },
  subtitle:     { fontSize: 12, color: C.t3, marginTop: 3 },

  servingsRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 18, borderTopWidth: 0.5, borderTopColor: C.border },
  servingsLbl:  { fontSize: 15, color: C.t1 },
  stepper:      { flexDirection: 'row', alignItems: 'center', gap: 14 },
  servingsInput:{ fontSize: 22, fontWeight: '700', color: C.t1, minWidth: 48, textAlign: 'center' },
  valuePill:    { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.s3, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, maxWidth: 170 },
  valuePillText:{ fontSize: 14, fontWeight: '700', color: C.accent },
  optionRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 15, borderTopWidth: 0.5, borderTopColor: C.border },
  optionText:   { fontSize: 16, color: C.t1 },
  dropdown:     { position: 'absolute', top: '100%', right: 0, minWidth: 190, maxHeight: 207, backgroundColor: C.s3, borderRadius: 12, zIndex: 100, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 12 },
  dropdownRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13 },
  dropdownDivider: { borderTopWidth: 0.5, borderTopColor: C.border },
  dropdownText: { fontSize: 15, color: C.t1 },

  macroRow:     { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 20, borderTopWidth: 0.5, borderTopColor: C.border },
  macroItem:    { flex: 1, alignItems: 'center' },
  macroVal:     { fontSize: 20, fontWeight: '800', color: C.t1 },
  macroLbl:     { fontSize: 11, color: C.t3, marginTop: 3 },

  saveBtn:      { backgroundColor: C.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  saveBtnText:  { fontSize: 15, fontWeight: '700', color: '#fff' },
  deleteBtn:    { paddingVertical: 14, alignItems: 'center' },
  deleteBtnText:{ fontSize: 14, color: '#FF375F' },
}); }
