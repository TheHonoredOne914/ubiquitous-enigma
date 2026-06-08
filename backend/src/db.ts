import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Supabase table types
export interface ArchiveRecord {
  id: number;
  name: string;
  topic: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationRecord {
  id: number;
  archive_id: number;
  title: string;
  created_at: string;
}

export interface MessageRecord {
  id: number;
  conversation_id: number;
  role: string;
  content: string;
  metadata_json?: string | null;
  run_id?: string | null;
  run_status?: string | null;
  run_phase?: string | null;
  run_last_heartbeat_at?: string | null;
  created_at: string;
}

export interface ArchiveContextRecord {
  archive_id: number;
  summary: string;
  updated_at: string;
}

export interface ArchiveResearchAnglesRecord {
  archive_id: number;
  angles_json: string;
  meta_json: string;
  updated_at: string;
}

export interface ArchiveIntelligenceProfileRecord {
  id: number;
  archive_id: number;
  agenda_text?: string | null;
  committee_type?: string | null;
  agenda_class?: string | null;
  primary_dimensions?: string | null;
  completed_divisions?: string | null;
  evidence_registry?: string | null;
  debate_utility_log?: string | null;
  dimension_engine_hash?: string | null;
  session_count?: number | null;
  updated_at?: string | null;
}

let _supabase: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!_supabase) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        'Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.'
      );
    }

    _supabase = createClient(supabaseUrl, supabaseKey);
  }
  return _supabase;
}

export async function listArchives(): Promise<ArchiveRecord[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('archives')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function createArchive(name: string, topic: string): Promise<ArchiveRecord> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  
  const { data, error } = await supabase
    .from('archives')
    .insert([{ name, topic, created_at: now, updated_at: now }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateArchive(
  id: number,
  updates: { name?: string; topic?: string }
): Promise<ArchiveRecord | null> {
  const supabase = getSupabaseClient();
  const updateData: Partial<ArchiveRecord> = { ...updates, updated_at: new Date().toISOString() };
  
  const { data, error } = await supabase
    .from('archives')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getArchiveById(id: number): Promise<ArchiveRecord | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('archives')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

export async function deleteArchive(id: number): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('archives').delete().eq('id', id);
  if (error) throw error;
  return true;
}

export async function getConversationsByArchiveId(archiveId: number): Promise<ConversationRecord[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('archive_id', archiveId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function createConversation(
  archiveId: number,
  title: string
): Promise<ConversationRecord> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  
  const { data, error } = await supabase
    .from('conversations')
    .insert([{ archive_id: archiveId, title, created_at: now }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getMessagesByConversationId(
  conversationId: number
): Promise<MessageRecord[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function createMessage(
  conversationId: number,
  role: string,
  content: string,
  metadata?: Record<string, unknown>
): Promise<MessageRecord> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  
  const { data, error } = await supabase
    .from('messages')
    .insert([{
      conversation_id: conversationId,
      role,
      content,
      metadata_json: metadata ? JSON.stringify(metadata) : null,
      created_at: now
    }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getArchiveContext(archiveId: number): Promise<ArchiveContextRecord | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('archive_contexts')
    .select('*')
    .eq('archive_id', archiveId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

export async function upsertArchiveContext(
  archiveId: number,
  summary: string
): Promise<ArchiveContextRecord> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  
  const { data, error } = await supabase
    .from('archive_contexts')
    .upsert([{ archive_id: archiveId, summary, updated_at: now }], { onConflict: 'archive_id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getArchiveResearchAngles(
  archiveId: number
): Promise<ArchiveResearchAnglesRecord | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('archive_research_angles')
    .select('*')
    .eq('archive_id', archiveId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

export async function upsertArchiveResearchAngles(
  archiveId: number,
  angles: string[],
  meta: Record<string, unknown> = {}
): Promise<ArchiveResearchAnglesRecord> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  
  const { data, error } = await supabase
    .from('archive_research_angles')
    .upsert([{
      archive_id: archiveId,
      angles_json: JSON.stringify(angles),
      meta_json: JSON.stringify(meta),
      updated_at: now
    }], { onConflict: 'archive_id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getArchiveIntelligenceProfile(
  archiveId: number
): Promise<ArchiveIntelligenceProfileRecord | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('archive_intelligence_profiles')
    .select('*')
    .eq('archive_id', archiveId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

export async function upsertArchiveIntelligenceProfile(
  archiveId: number,
  profile: Partial<Omit<ArchiveIntelligenceProfileRecord, 'id' | 'archive_id' | 'updated_at'>>
): Promise<ArchiveIntelligenceProfileRecord> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  
  const { data, error } = await supabase
    .from('archive_intelligence_profiles')
    .upsert([{
      archive_id: archiveId,
      ...profile,
      updated_at: now
    }], { onConflict: 'archive_id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function countArchives(): Promise<number> {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from('archives')
    .select('*', { count: 'exact', head: true });

  if (error) throw error;
  return count || 0;
}

export async function countConversationsByArchiveId(archiveId: number): Promise<number> {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .eq('archive_id', archiveId);

  if (error) throw error;
  return count || 0;
}
