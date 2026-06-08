import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Supabase table types
export interface ArchiveRecord {
  id: number;
  name: string;
  topic: string;
  researchAngles?: string[];
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

export interface ApiArchiveRecord {
  id: number;
  name: string;
  topic: string;
  researchAngles?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ApiConversationRecord {
  id: number;
  archiveId: number;
  title: string;
  createdAt: string;
}

export interface ApiMessageRecord {
  id: number;
  conversationId: number;
  role: string;
  content: string;
  metadataJson?: string | null;
  runId?: string | null;
  runStatus?: string | null;
  runPhase?: string | null;
  runLastHeartbeatAt?: string | null;
  createdAt: string;
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

export function toApiArchive(record: ArchiveRecord): ApiArchiveRecord {
  return {
    id: record.id,
    name: record.name,
    topic: record.topic,
    researchAngles: record.researchAngles,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

export function toApiConversation(record: ConversationRecord): ApiConversationRecord {
  return {
    id: record.id,
    archiveId: record.archive_id,
    title: record.title,
    createdAt: record.created_at,
  };
}

export function toApiMessage(record: MessageRecord): ApiMessageRecord {
  return {
    id: record.id,
    conversationId: record.conversation_id,
    role: record.role,
    content: record.content,
    metadataJson: record.metadata_json,
    runId: record.run_id,
    runStatus: record.run_status,
    runPhase: record.run_phase,
    runLastHeartbeatAt: record.run_last_heartbeat_at,
    createdAt: record.created_at,
  };
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

export async function listConversations(): Promise<ConversationRecord[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
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

export async function getConversationById(id: number): Promise<ConversationRecord | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

export async function updateConversationTitle(id: number, title: string): Promise<ConversationRecord | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('conversations')
    .update({ title })
    .eq('id', id)
    .select()
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

export async function deleteConversation(id: number): Promise<ConversationRecord | null> {
  const conversation = await getConversationById(id);
  if (!conversation) return null;

  const supabase = getSupabaseClient();
  const { error } = await supabase.from('conversations').delete().eq('id', id);
  if (error) throw error;
  return conversation;
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
  metadata?: Record<string, unknown> | null,
  runId?: string | null,
  runStatus?: string | null
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
      run_id: runId ?? null,
      run_status: runStatus ?? null,
      run_phase: runStatus ? 'terminal' : null,
      run_last_heartbeat_at: runStatus ? now : null,
      created_at: now
    }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function createMessageFromJson(
  conversationId: number,
  role: string,
  content: string,
  metadataJson?: string | null,
  runId?: string | null,
  runStatus?: string | null
): Promise<MessageRecord> {
  const parsedMetadata = metadataJson ? JSON.parse(metadataJson) as Record<string, unknown> : null;
  return createMessage(conversationId, role, content, parsedMetadata, runId, runStatus);
}

export async function updateMessage(
  id: number,
  updates: {
    content?: string;
    metadataJson?: string | null;
    runId?: string | null;
    runStatus?: string | null;
  }
): Promise<MessageRecord | null> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  const updateData: Record<string, unknown> = {};

  if (updates.content !== undefined) updateData.content = updates.content;
  if (updates.metadataJson !== undefined) updateData.metadata_json = updates.metadataJson;
  if (updates.runId !== undefined) updateData.run_id = updates.runId;
  if (updates.runStatus !== undefined) {
    updateData.run_status = updates.runStatus;
    updateData.run_phase = 'terminal';
    updateData.run_last_heartbeat_at = now;
  }

  const { data, error } = await supabase
    .from('messages')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
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
