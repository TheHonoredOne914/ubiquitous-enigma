import React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CouncillorCard } from "./councillor-card";
import { ChiefVerdictPanel } from "./chief-verdict-panel";
import { DeliberationBoard } from "./deliberation-board";
import { FloorStrategyPanel } from "./floor-strategy-panel";
import { downloadCouncilDossier } from "./council-dossier-export";
import { RETRIEVING_COUNCILLOR_IDS, type CouncilSession } from "./council-types";

export function CouncilChamberPanel({ session }: { session: CouncilSession | null }) {
  if (!session) {
    return (
      <section className="rounded-2xl border border-[#27324a] bg-[linear-gradient(145deg,rgba(13,18,30,0.94),rgba(7,9,14,0.96))] p-5 text-slate-300">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-200">Council Mode</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-50">Council chamber initializing</h2>
        <p className="mt-2 text-sm text-[#96a2b8]">Six specialist councillors are preparing the parliamentary advisory session.</p>
      </section>
    );
  }

  const completedCount = RETRIEVING_COUNCILLOR_IDS.filter((id) => session.councillors[id]?.status === "complete").length;
  const status = statusCopy(session.status);
  const side = session.stance === "government" ? "Treasury Bench" : session.stance === "opposition" ? "Opposition" : "Independent brief";

  return (
    <section className="space-y-5" data-council-chamber>
      <div className="relative overflow-hidden rounded-[28px] border border-[#27324a] bg-[radial-gradient(circle_at_top,rgba(59,111,212,0.16),transparent_36%),linear-gradient(145deg,rgba(12,17,29,0.96),rgba(7,9,14,0.98))] p-5 shadow-[0_24px_90px_-52px_rgba(59,111,212,0.7)]">
        <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-amber-200/55 to-transparent" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100">
                Council Mode
              </span>
              <span className="rounded-full border border-[#3b6fd4]/35 bg-[#3b6fd4]/10 px-2.5 py-1 text-[11px] text-[#b9caff]">
                Parliamentary Advisory Session
              </span>
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl">Council Chamber</h2>
            <p className="mt-2 max-w-3xl break-words text-sm leading-6 text-[#a7b1c5]">
              Six specialist councillors are stress-testing your case and preparing floor strategy.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-medium text-emerald-100">
              {status}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => downloadCouncilDossier(session)}
              disabled={session.status !== "complete"}
              className="border-amber-300/30 bg-black/20 text-amber-100 hover:bg-amber-300/10 hover:text-amber-50"
            >
              <Download className="mr-2 h-4 w-4" />
              Download Chamber Brief
            </Button>
          </div>
        </div>

        <div className="relative mt-5 grid gap-3 lg:grid-cols-[1.3fr_0.7fr_0.7fr_0.7fr]">
          <HeaderStat label="Agenda" value={session.topic || "Committee agenda pending"} />
          <HeaderStat label="House / committee" value="Indian parliamentary committee" />
          <HeaderStat label="Role / side" value={side} />
          <HeaderStat label="Councillors" value={`${completedCount}/6 briefs sealed`} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {RETRIEVING_COUNCILLOR_IDS.map((id) => (
          <CouncillorCard key={id} councillorId={id} output={session.councillors[id]} />
        ))}
      </div>
      <DeliberationBoard seals={session.seals} disputes={session.disputes} agreementScore={session.agreement_score} />
      <FloorStrategyPanel verdict={session.verdict} />
      <ChiefVerdictPanel verdict={session.verdict} stream={session.chief_verdict_stream} />
      <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.055] p-4 text-sm text-amber-50">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">Council Dossier</p>
            <p className="mt-1 text-[#d8cda9]">Package the verdict, conflict lines, POIs, and chamber strategy into a usable floor brief.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => downloadCouncilDossier(session)}
            disabled={session.status !== "complete"}
            className="border-amber-300/30 bg-black/20 text-amber-100 hover:bg-amber-300/10 hover:text-amber-50"
          >
            <Download className="mr-2 h-4 w-4" />
            Strategy Brief
          </Button>
        </div>
      </div>
    </section>
  );
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/25 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7f8aa3]">{label}</p>
      <p className="mt-1 break-words text-sm leading-5 text-[#e5ebfb]">{value}</p>
    </div>
  );
}

function statusCopy(status: CouncilSession["status"]): string {
  if (status === "briefing") return "Chamber Active";
  if (status === "deliberating") return "Deliberation Running";
  if (status === "synthesizing") return "Strategy Synthesizing";
  if (status === "complete") return "Chamber Concluded";
  return "Council Error";
}
