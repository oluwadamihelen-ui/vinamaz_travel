import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplicationSummary } from "@/components/apply/summary";
import { ProgressBar } from "@/components/apply/progress";
import { AssignForm, DocumentReviewControls, NoteForm, StatusForm } from "@/components/admin/application-actions";
import { Alert, Badge, Card } from "@/components/ui/misc";
import { DOC_STATUS_LABEL, DOC_STATUS_TONE, STATUS_LABEL, STATUS_TONE } from "@/lib/applications/labels";
import { requireStaffPage } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { getAdminApplicationView } from "@/lib/services/admin-applications";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Application · Admin" };
export const dynamic = "force-dynamic";

const TABS = [
  ["overview", "Overview"], ["applicant", "Applicant"], ["form", "Application form"], ["documents", "Documents"],
  ["payments", "Payments"], ["timeline", "Timeline"], ["messages", "Messages"], ["notes", "Internal notes"],
] as const;

const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs uppercase tracking-wider text-ink-3">{label}</dt><dd className="mt-0.5 font-medium">{children}</dd></div>;
}

export default async function AdminApplicationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const actor = await requireStaffPage("applications.view");
  const { id } = await params;
  const requestedTab = (await searchParams).tab;
  const tab = TABS.some(([k]) => k === requestedTab) ? requestedTab! : "overview";
  let v;
  try {
    v = await getAdminApplicationView(actor, id);
  } catch (e) {
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
  const { app, client, permissions: perm } = v;
  const awaitingReview = v.currentDocs.filter((d) => d.status === "UPLOADED" || d.status === "UNDER_REVIEW").length;
  const awaitingClient = v.currentDocs.filter((d) => d.status === "REJECTED" || d.status === "REPLACEMENT_REQUIRED").length;
  const missingRequired = v.slots.filter((s) => s.isRequired && !v.currentDocs.some((d) => d.requirementKey === s.key)).length;
  const base = `/admin/applications/${app.id}`;

  return (
    <div className="space-y-6">
      <Link href="/admin/applications" className="text-sm font-medium text-brand hover:underline">← All applications</Link>

      <header className="rounded-2xl border border-line bg-white p-5 shadow-card sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{app.packageCountry} · {app.packageName}</p>
            <h1 className="mt-1 text-3xl font-semibold">{app.applicationNumber}</h1>
            <p className="mt-1 text-ink-3">{client.name} · {client.email}{client.phone ? ` · ${client.phone}` : ""}</p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Badge tone={STATUS_TONE[app.status]} className="px-3.5 py-1.5 text-sm">{STATUS_LABEL[app.status]}</Badge>
            <p className="text-sm text-ink-3">Payment: <span className="font-medium text-ink">Not yet tracked</span></p>
          </div>
        </div>
      </header>

      <nav aria-label="Application sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {TABS.map(([key, label]) => (
            <li key={key}>
              <Link href={`${base}?tab=${key}`} aria-current={tab === key ? "page" : undefined}
                className={cn("flex min-h-11 items-center border-b-2 px-4 text-sm font-medium", tab === key ? "border-brand text-brand" : "border-transparent text-ink-3 hover:text-ink")}>
                {label}
                {key === "documents" && awaitingReview > 0 && <span className="ml-2 rounded-full bg-gold-bright px-1.5 text-xs text-ink">{awaitingReview}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-6">
            <Card className="p-6">
              <h2 className="text-xl font-semibold">Summary</h2>
              <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
                <Fact label="Client">{client.name}</Fact>
                <Fact label="Package">{app.packageName}</Fact>
                <Fact label="Submitted">{app.submittedAt ? when(app.submittedAt) : "Not submitted"}</Fact>
                <Fact label="Last updated">{when(app.updatedAt)}</Fact>
                <Fact label="Assigned to">{v.assignedTo?.name ?? "Unassigned"}</Fact>
                <Fact label="Form completion"><ProgressBar percent={v.progress.percent} className="mt-1" /></Fact>
              </dl>
            </Card>
            <Card className="p-6">
              <h2 className="text-xl font-semibold">Action required</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {app.status === "DRAFT" && <li>Client has not submitted yet.</li>}
                {awaitingReview > 0 && <li><Link className="font-medium text-brand hover:underline" href={`${base}?tab=documents`}>{awaitingReview} document{awaitingReview > 1 ? "s" : ""} awaiting review</Link></li>}
                {awaitingClient > 0 && <li>Waiting on the client to replace {awaitingClient} document{awaitingClient > 1 ? "s" : ""}.</li>}
                {app.status !== "DRAFT" && missingRequired > 0 && <li>{missingRequired} required document{missingRequired > 1 ? "s are" : " is"} missing.</li>}
                {!app.assignedToId && app.status !== "DRAFT" && <li>No staff member is assigned yet.</li>}
                {app.status === "APPLICATION_SUBMITTED" && <li>New application: begin review.</li>}
                {app.status !== "DRAFT" && awaitingReview === 0 && awaitingClient === 0 && missingRequired === 0 && app.assignedToId && app.status !== "APPLICATION_SUBMITTED" && <li className="text-ink-3">Nothing needs attention right now.</li>}
              </ul>
            </Card>
          </div>
          <div className="space-y-6">
            {perm.statusUpdate && (
              <Card className="p-6">
                <h2 className="mb-4 text-xl font-semibold">Update status</h2>
                <StatusForm applicationId={app.id} current={app.status} allowed={v.allowedNext} canOverride />
              </Card>
            )}
            {perm.assign && (
              <Card className="p-6">
                <h2 className="mb-4 text-xl font-semibold">Assignment</h2>
                <AssignForm applicationId={app.id} staff={v.staff} currentId={app.assignedToId} />
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "applicant" && (
        <Card className="p-6 sm:p-8">
          <h2 className="text-xl font-semibold">Account</h2>
          <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <Fact label="Name">{client.name}</Fact>
            <Fact label="Email">{client.email}</Fact>
            <Fact label="Phone">{client.phone ?? "—"}</Fact>
            <Fact label="WhatsApp">{client.clientProfile?.whatsapp ?? "—"}</Fact>
            <Fact label="Nationality">{client.clientProfile?.nationality ?? "—"}</Fact>
            <Fact label="Country of residence">{client.clientProfile?.countryOfResidence ?? "—"}</Fact>
            <Fact label="Client since">{client.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</Fact>
          </dl>
          <h2 className="mt-8 text-xl font-semibold">Details given on this application</h2>
          <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {Object.entries((app.applicant ?? {}) as Record<string, unknown>).map(([k, val]) => (
              <Fact key={k} label={k.replace(/([A-Z])/g, " $1").toLowerCase()}>{(val as string) || "—"}</Fact>
            ))}
          </dl>
        </Card>
      )}

      {tab === "form" && (
        <Card className="p-6 sm:p-8">
          <ApplicationSummary applicant={(app.applicant ?? {}) as Record<string, unknown>} steps={v.steps} questions={v.config.questions} answers={v.answers} slots={[]} docs={[]} />
        </Card>
      )}

      {tab === "documents" && (
        !perm.viewDocs ? <Alert>You don&rsquo;t have permission to view documents.</Alert> : (
          <div className="space-y-4">
            {v.slots.map((slot) => {
              const cur = v.currentDocs.find((d) => d.requirementKey === slot.key);
              const older = v.documents.filter((d) => d.requirementKey === slot.key && !d.isCurrent);
              return (
                <Card key={slot.key} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><p className="font-semibold">{slot.name}</p><p className="text-xs text-ink-3">{slot.isRequired ? "Required" : "Optional"}</p></div>
                    {cur ? <Badge tone={DOC_STATUS_TONE[cur.status]}>{DOC_STATUS_LABEL[cur.status]}</Badge> : <Badge tone={slot.isRequired ? "gold" : "neutral"}>Not uploaded</Badge>}
                  </div>
                  {cur && (
                    <div className="mt-3 rounded-xl bg-paper p-3 text-sm">
                      <p><a className="font-medium text-brand hover:underline" href={`/api/documents/${cur.id}`}>{cur.originalFilename}</a> <a className="ml-2 text-xs text-ink-3 underline" href={`/api/documents/${cur.id}?inline=1`} target="_blank" rel="noreferrer">view</a></p>
                      <p className="text-xs text-ink-3">{(cur.sizeBytes / 1024).toFixed(0)} KB · uploaded {when(cur.createdAt)}{cur.uploadedByName ? ` by ${cur.uploadedByName}` : ""}</p>
                      {cur.rejectionReason && <p className="mt-1 text-gold"><strong>Reason given to client:</strong> {cur.rejectionReason}</p>}
                      {cur.reviewedAt && <p className="text-xs text-ink-3">Reviewed {when(cur.reviewedAt)}{cur.reviewedByName ? ` by ${cur.reviewedByName}` : ""}</p>}
                      {perm.reviewDocs && <DocumentReviewControls applicationId={app.id} documentId={cur.id} status={cur.status} />}
                    </div>
                  )}
                  {older.length > 0 && (
                    <details className="mt-3 text-sm">
                      <summary className="cursor-pointer text-ink-3">Previous versions ({older.length})</summary>
                      <ul className="mt-2 space-y-1">
                        {older.map((d) => <li key={d.id}><a className="text-brand hover:underline" href={`/api/documents/${d.id}`}>{d.originalFilename}</a> <span className="text-xs text-ink-3">· {when(d.createdAt)} · {DOC_STATUS_LABEL[d.status]}{d.rejectionReason ? ` · ${d.rejectionReason}` : ""}</span></li>)}
                      </ul>
                    </details>
                  )}
                </Card>
              );
            })}
            {v.slots.length === 0 && <Card className="p-8 text-center text-ink-3">This package has no document requirements.</Card>}
          </div>
        )
      )}

      {tab === "payments" && <Card className="p-8 text-center text-ink-3">Payments for this application will appear here once online payments are enabled.</Card>}

      {tab === "timeline" && (
        <Card className="p-6 sm:p-8">
          <ol className="space-y-5">
            {v.history.map((h) => (
              <li key={h.id} className="border-l-2 border-line pl-4">
                <p className="font-medium">
                  {h.fromStatus ? `${STATUS_LABEL[h.fromStatus]} → ` : ""}{STATUS_LABEL[h.toStatus]}
                  {h.isOverride && <Badge tone="gold" className="ml-2">Override</Badge>}
                </p>
                <p className="text-xs text-ink-3">{when(h.createdAt)} · {h.changedByName ?? "System"}</p>
                {h.note && <p className="mt-1 rounded-xl bg-paper px-3 py-2 text-sm"><span className="text-ink-3">Message to client:</span> {h.note}</p>}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {tab === "messages" && <Card className="p-8 text-center text-ink-3">Messaging with the client will be available here in an upcoming release.</Card>}

      {tab === "notes" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          {perm.addNotes ? <Card className="p-6"><NoteForm applicationId={app.id} /></Card> : <Alert>You don&rsquo;t have permission to add notes.</Alert>}
          <Card className="p-6">
            <h2 className="text-xl font-semibold">Internal notes</h2>
            <p className="text-xs text-ink-3">Visible to staff only.</p>
            {v.notes.length === 0 ? <p className="mt-4 text-sm text-ink-3">No notes yet.</p> : (
              <ul className="mt-4 space-y-3">
                {v.notes.map((n) => <li key={n.id} className="rounded-xl bg-paper p-3 text-sm"><p className="whitespace-pre-line">{n.body}</p><p className="mt-1 text-xs text-ink-3">{n.author?.name ?? "Former user"} · {when(n.createdAt)}</p></li>)}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
