export const DISCIPLINES = [
  "Architectural",
  "Structural",
  "Mechanical",
  "Electrical",
  "Civil / Site",
  "Landscape",
  "Fire Protection",
  "General",
];
export const FILE_KINDS = [
  "Drawing",
  "Shop Drawing",
  "Specification",
  "Schedule",
  "Site Instruction",
  "Permit",
  "Report",
  "Other",
];
export const ISSUE_STATUSES = [
  "For Review",
  "For Tender",
  "Issued for Construction",
  "As Built",
  "For Information",
];
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  dwg: "application/octet-stream",
  dxf: "application/octet-stream",
  zip: "application/zip",
  txt: "text/plain",
  csv: "text/csv",
};
export type FileRevision = {
  id: string;
  document_id: string;
  label: string;
  issue_date: string;
  issue_status: string;
  filename: string;
  bytes: number;
  mime: string;
  uploaded_by: string;
  uploader_name: string;
  uploaded_at: string;
  ever_published: boolean;
  ready: boolean;
};
export type ProjectDocument = {
  id: string;
  project_id: string;
  number: string;
  title: string;
  discipline: string;
  kind: string;
  folder: string;
  current_revision: string | null;
  publisher_name: string | null;
  published_at: string | null;
  version: number;
  created_at: string;
};
export type FileAudit = {
  id: number;
  document_id: string | null;
  revision_id: string | null;
  action: string;
  actor_name: string;
  created_at: string;
};
export type PortalSettings = {
  token: string;
  enabled: boolean;
  has_pin: boolean;
  expires_at: string | null;
  version: number;
};
export type FileWorkspace = {
  documents: ProjectDocument[];
  revisions: FileRevision[];
  audit: FileAudit[];
  portal: PortalSettings;
};
export type PublishedFile = {
  id: string;
  revision_id: string;
  number: string;
  title: string;
  discipline: string;
  kind: string;
  label: string;
  issue_date: string;
  issue_status: string;
  filename: string;
  bytes: number;
  mime: string;
};
export function fileSize(n: number) {
  return n < 1024 * 1024
    ? `${Math.ceil(n / 1024)} KB`
    : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
export function fileMime(name: string) {
  return FILE_TYPES[name.split(".").pop()?.toLowerCase() || ""];
}
