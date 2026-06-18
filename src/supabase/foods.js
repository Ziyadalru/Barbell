import { isSupabaseConfigured, supabase } from './client';

const toAppFood = (row) => ({
  id: `sb_${row.id}`,
  supabaseId: row.id,
  name: row.name,
  brand: row.brand || row.restaurant || '',
  restaurant: row.restaurant || '',
  serving: row.serving || '100g',
  cal: Math.round(Number(row.calories) || 0),
  p: Math.round(Number(row.protein) || 0),
  c: Math.round(Number(row.carbs) || 0),
  f: Math.round(Number(row.fat) || 0),
  fiber: Math.round(Number(row.fiber) || 0),
  sugar: Math.round(Number(row.sugar) || 0),
  satFat: Math.round(Number(row.saturated_fat) || 0),
  sodium: Math.round(Number(row.sodium) || 0),
  verified: row.verified,
  sourceType: row.source_type,
  sourceUrl: row.source_url,
});

export async function searchSupabaseFoods(query, limit = 12) {
  const q = query?.trim();
  if (!isSupabaseConfigured || !q) return [];

  const { data, error } = await supabase
    .from('foods')
    .select('id,name,brand,restaurant,serving,calories,protein,carbs,fat,fiber,sugar,saturated_fat,sodium,verified,source_type,source_url')
    .eq('public_visible', true)
    .ilike('search_text', `%${q.toLowerCase()}%`)
    .order('verified', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []).map(toAppFood);
}

export async function getSupabaseFoodByBarcode(barcode) {
  if (!isSupabaseConfigured || !barcode) return null;

  const { data, error } = await supabase
    .from('food_barcodes')
    .select(`
      barcode,
      foods (
        id,name,brand,restaurant,serving,calories,protein,carbs,fat,
        fiber,sugar,saturated_fat,sodium,verified,source_type,source_url
      )
    `)
    .eq('barcode', String(barcode))
    .maybeSingle();

  if (error) throw error;
  return data?.foods ? toAppFood(data.foods) : null;
}
