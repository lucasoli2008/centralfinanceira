import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/errors";
import type { AuditLogRow, EntryImportRow, MemberStatus } from "@/types/database";
import type { MemberRole } from "@/lib/finance/types";

export interface MemberSummary {
  id: string;
  userId: string;
  role: MemberRole;
  status: MemberStatus;
  fullName: string;
  isActive: boolean;
  createdAt: string;
}

export async function listMembers(): Promise<MemberSummary[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("organization_members")
    .select("id, user_id, role, status, created_at, profiles:user_id (full_name, is_active)")
    .order("created_at");

  if (error) {
    logServerError("queries.listMembers", error);
    return [];
  }

  return (data ?? []).map((row) => {
    const profile = row.profiles as unknown as {
      full_name: string | null;
      is_active: boolean;
    } | null;
    return {
      id: row.id as string,
      userId: row.user_id as string,
      role: row.role as MemberRole,
      status: row.status as MemberStatus,
      fullName: profile?.full_name ?? "—",
      isActive: profile?.is_active ?? true,
      createdAt: row.created_at as string,
    };
  });
}

export interface AuditFilters {
  from?: string | null;
  to?: string | null;
  entityType?: string | null;
  action?: string | null;
  userId?: string | null;
  page?: number;
  pageSize?: number;
}

export interface AuditLogEntry extends AuditLogRow {
  userName: string | null;
}

export async function listAuditLogs(
  filters: AuditFilters = {},
): Promise<{ rows: AuditLogEntry[]; total: number }> {
  const supabase = await createSupabaseServerClient();
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const offset = (page - 1) * pageSize;

  let query = supabase
    .from("audit_logs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00`);
  if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59`);
  if (filters.entityType) query = query.eq("entity_type", filters.entityType);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.userId) query = query.eq("user_id", filters.userId);

  const { data, error, count } = await query;

  if (error) {
    logServerError("queries.listAuditLogs", error);
    return { rows: [], total: 0 };
  }

  const rows = (data ?? []) as AuditLogRow[];
  const userIds = Array.from(
    new Set(rows.map((row) => row.user_id).filter((id): id is string => Boolean(id))),
  );

  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", userIds)
    : { data: [] };

  const nameById = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));

  return {
    rows: rows.map((row) => ({
      ...row,
      userName: row.user_id ? (nameById.get(row.user_id) ?? null) : null,
    })),
    total: count ?? rows.length,
  };
}

export async function listImports(): Promise<EntryImportRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("entry_imports")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  return (data ?? []) as EntryImportRow[];
}
