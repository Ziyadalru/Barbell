import AsyncStorage from '@react-native-async-storage/async-storage';

export function parseStoredJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function getJson(key, fallback) {
  const raw = await AsyncStorage.getItem(key);
  return parseStoredJson(raw, fallback);
}

export async function setJson(key, value) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export function entriesToObject(entries) {
  return Object.fromEntries(entries);
}
