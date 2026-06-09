import React, { useState } from "react";
import { Download, ChevronRight, CheckCircle2, AlertTriangle, Shield, Target, Lightbulb, MessageSquareWarning, BookOpen, Scale, TrendingUp, Users, Clock, History, BrainCircuit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CouncillorCard } from "./councillor-card";
import { ChiefVerdictPanel } from "./chief-verdict-panel";
import { DeliberationBoard } from "./deliberation-board";
import { FloorStrategyPanel } from "./floor-strategy-panel";
import { downloadCouncilDossier } from "./council-dossier-export";
import { RETRIEVING_COUNCILLOR_IDS, type CouncilSession } from "./council-types";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

export function CouncilChamberPanel({ session }: { session: CouncilSession | null }) {
  const [activeTab, setActiveTab] = useState<"overview" | "councillors" | "deliberation" | "strategy">("overview");

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
  
  // Calculate phase progress
  const getPhaseProgress = () => {
    if (session.status === "expanding" || session.status === "retrieving") return 20;
    if (session.status === "briefing") return 40 + (completedCount / 6) * 20;
    if (session.status === "deliberating") return 70;
    if (session.status === "synthesizing") return 85;
    if (session.status === "complete") return 100;
    return 0;
  };

  const phaseProgress = getPhaseProgress();

  return (
    <section className="space-y-6" data-council-chamber>
      {/* Hero Header with Pipeline Progress */}
      <div className="relative overflow-hidden rounded-[28px] border border-[#27324a] bg-[radial-gradient(circle_at_top,rgba(59,111,212,0.16),transparent_36%),linear-gradient(145deg,rgba(12,17,29,0.96),rgba(7,9,14,0.98))] p-6 shadow-[0_24px_90px_-52px_rgba(59,111,212,0.7)]">
        <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-amber-200/55 to-transparent" />
        
        {/* Phase Indicator Pills */}
        <div className="mb-4 flex flex-wrap gap-2">
          <PhasePill label="Planning" icon={<BrainCircuit className="h-3 w-3" />} active={session.status === "expanding" || session.status === "retrieving"} completed={phaseProgress > 40} />
          <PhasePill label="Evidence Gathering" icon={<BookOpen className="h-3 w-3" />} active={session.status === "briefing"} completed={phaseProgress > 60} />
          <PhasePill label="Deliberation" icon={<Users className="h-3 w-3" />} active={session.status === "deliberating"} completed={phaseProgress > 85} />
          <PhasePill label="Synthesis" icon={<Lightbulb className="h-3 w-3" />} active={session.status === "synthesizing"} completed={phaseProgress >= 100} />
        </div>

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100">
                Council Mode
              </span>
              <span className="rounded-full border border-[#3b6fd4]/35 bg-[#3b6fd4]/10 px-2.5 py-1 text-[11px] text-[#b9caff]">
                Parliamentary Advisory Session
              </span>
              <Badge variant="outline" className="border-emerald-300/20 bg-emerald-300/10 text-emerald-100">
                {side}
              </Badge>
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl">{session.topic}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#a7b1c5]">
              Six specialist councillors are stress-testing your case across legal, economic, strategic, social, historical, and opposition perspectives.
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

        {/* Pipeline Progress Bar */}
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-[#7f8aa3]">Pipeline Progress</span>
            <span className="font-semibold text-amber-100">{Math.round(phaseProgress)}%</span>
          </div>
          <Progress value={phaseProgress} className="h-2 bg-white/[0.06]" />
          <div className="mt-3 grid grid-cols-4 gap-2 text-[10px] text-[#7f8aa3]">
            <div className={`text-center ${phaseProgress >= 20 ? "text-amber-200" : ""}`}>Planning & Assignment</div>
            <div className={`text-center ${phaseProgress >= 40 ? "text-amber-200" : ""}`}>Targeted Enrichment</div>
            <div className={`text-center ${phaseProgress >= 70 ? "text-amber-200" : ""}`}>Parallel Briefs</div>
            <div className={`text-center ${phaseProgress >= 100 ? "text-amber-200" : ""}`}>Chief Synthesis</div>
          </div>
        </div>
      </div>

      {/* Tabbed Navigation for Different Views */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
        <TabsList className="grid w-full grid-cols-4 bg-[#0f1420]/50">
          <TabsTrigger value="overview" className="data-[state=active]:bg-[#3b6fd4]/20">Overview</TabsTrigger>
          <TabsTrigger value="councillors" className="data-[state=active]:bg-[#3b6fd4]/20">Councillors ({completedCount}/6)</TabsTrigger>
          <TabsTrigger value="deliberation" className="data-[state=active]:bg-[#3b6fd4]/20">Deliberation</TabsTrigger>
          <TabsTrigger value="strategy" className="data-[state=active]:bg-[#3b6fd4]/20">Floor Strategy</TabsTrigger>
        </TabsList>

        {/* Overview Tab - Shows key highlights */}
        <TabsContent value="overview" className="mt-4 space-y-6">
          {/* Quick Stats Grid */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard 
              icon={<Scale className="h-4 w-4 text-[#3b6fd4]" />}
              label="Legal Analysis"
              value={session.councillors.C1_LEGAL?.status === "complete" ? "Complete" : session.councillors.C1_LEGAL?.status === "running" ? "In Progress" : "Pending"}
              status={session.councillors.C1_LEGAL?.status}
            />
            <StatCard 
              icon={<TrendingUp className="h-4 w-4 text-emerald-400" />}
              label="Economic Impact"
              value={session.councillors.C2_ECONOMIC?.status === "complete" ? "Complete" : session.councillors.C2_ECONOMIC?.status === "running" ? "In Progress" : "Pending"}
              status={session.councillors.C2_ECONOMIC?.status}
            />
            <StatCard 
              icon={<Shield className="h-4 w-4 text-purple-400" />}
              label="Strategic Posture"
              value={session.councillors.C3_STRATEGIC?.status === "complete" ? "Complete" : session.councillors.C3_STRATEGIC?.status === "running" ? "In Progress" : "Pending"}
              status={session.councillors.C3_STRATEGIC?.status}
            />
            <StatCard 
              icon={<AlertTriangle className="h-4 w-4 text-amber-400" />}
              label="Opposition Attacks"
              value={session.councillors.C6_OPPOSITION?.key_claims?.filter(c => c.stance === "challenges").length ?? 0}
              sublabel="Vulnerabilities found"
            />
          </div>

          {/* Consensus vs Conflict Preview */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-emerald-300/15 bg-emerald-300/[0.045]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-100 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  Council Seals ({session.seals.length})
                </CardTitle>
                <CardDescription className="text-xs text-emerald-200/80">
                  Claims endorsed by multiple councillors
                </CardDescription>
              </CardHeader>
              <CardContent>
                {session.seals.slice(0, 2).map((seal) => (
                  <div key={seal.seal_id} className="mb-2 rounded-lg border border-emerald-200/10 bg-black/20 p-3 text-sm text-emerald-50">
                    <p className="leading-6">{seal.claim.text}</p>
                    <p className="mt-2 text-xs text-emerald-200">
                      Endorsed by {seal.endorsing_councillors.length} councillors
                    </p>
                  </div>
                ))}
                {session.seals.length === 0 && (
                  <p className="text-sm text-[#96a2b8]">No consensus formed yet. Deliberation in progress.</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-amber-300/18 bg-amber-300/[0.05]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-100 flex items-center gap-2">
                  <MessageSquareWarning className="h-4 w-4" />
                  Key Disputes ({session.disputes.length})
                </CardTitle>
                <CardDescription className="text-xs text-amber-200/80">
                  Contested claims requiring strategic handling
                </CardDescription>
              </CardHeader>
              <CardContent>
                {session.disputes.slice(0, 2).map((dispute) => (
                  <div key={dispute.dispute_id} className="mb-2 rounded-lg border border-amber-200/10 bg-black/20 p-3 text-sm text-amber-50">
                    <p className="leading-6">{dispute.claim_a.text}</p>
                    <p className="mt-2 text-xs leading-5 text-amber-200">Challenged by: {dispute.claim_b.text}</p>
                    <p className="mt-2 text-[10px] uppercase tracking-[0.16em] text-[#a89977]">{dispute.conflict_type.replace(/_/g, " ")}</p>
                  </div>
                ))}
                {session.disputes.length === 0 && (
                  <p className="text-sm text-[#96a2b8]">No major disputes identified yet.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Chief Verdict Preview */}
          {session.verdict && (
            <Card className="border-amber-300/24 bg-[radial-gradient(circle_at_top_right,rgba(212,160,59,0.16),transparent_34%),linear-gradient(155deg,rgba(15,18,25,0.98),rgba(7,9,14,0.98))]">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg font-semibold text-slate-50 flex items-center gap-2">
                  <Lightbulb className="h-5 w-5 text-amber-300" />
                  Chief Councillor's Strategic Position
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap break-words text-base leading-7 text-[#eef3ff]">
                  {session.verdict.strategic_position}
                </p>
                <Separator className="my-4 bg-white/[0.07]" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100 mb-2">Top Arguments</h4>
                    <ul className="space-y-1 text-sm text-[#d9e2f8]">
                      {session.verdict.top_arguments.slice(0, 2).map((arg, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <CheckCircle2 className="h-3 w-3 mt-1 text-emerald-400 shrink-0" />
                          <span>{arg.argument}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-100 mb-2">Critical Vulnerabilities</h4>
                    <ul className="space-y-1 text-sm text-[#d9e2f8]">
                      {session.verdict.top_vulnerabilities.slice(0, 2).map((vuln, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <AlertTriangle className="h-3 w-3 mt-1 text-amber-400 shrink-0" />
                          <span>{vuln.vulnerability}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Councillors Tab - Full councillor cards */}
        <TabsContent value="councillors" className="mt-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {RETRIEVING_COUNCILLOR_IDS.map((id) => (
              <CouncillorCard key={id} councillorId={id} output={session.councillors[id]} />
            ))}
          </div>
        </TabsContent>

        {/* Deliberation Tab - Full deliberation board */}
        <TabsContent value="deliberation" className="mt-4">
          <DeliberationBoard seals={session.seals} disputes={session.disputes} agreementScore={session.agreement_score} />
        </TabsContent>

        {/* Strategy Tab - Floor strategy and chief verdict */}
        <TabsContent value="strategy" className="mt-4 space-y-6">
          <FloorStrategyPanel verdict={session.verdict} />
          <ChiefVerdictPanel verdict={session.verdict} stream={session.chief_verdict_stream} />
        </TabsContent>
      </Tabs>

      {/* Export CTA */}
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

function PhasePill({ label, icon, active, completed }: { label: string; icon: React.ReactNode; active: boolean; completed: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-all ${
      completed 
        ? "border border-emerald-300/30 bg-emerald-300/10 text-emerald-100" 
        : active 
          ? "border border-[#3b6fd4]/45 bg-[#3b6fd4]/15 text-[#b8caff]" 
          : "border border-white/10 bg-white/[0.04] text-slate-400"
    }`}>
      {completed ? <CheckCircle2 className="h-3 w-3" /> : icon}
      {label}
    </span>
  );
}

function StatCard({ icon, label, value, sublabel, status }: { icon: React.ReactNode; label: string; value: string | number; sublabel?: string; status?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-black/25 p-3">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7f8aa3]">{label}</span>
      </div>
      <p className="mt-2 text-lg font-semibold text-slate-50">{value}</p>
      {sublabel && <p className="text-[10px] text-[#7f8aa3]">{sublabel}</p>}
      {status && status !== "complete" && (
        <span className={`mt-1 inline-block text-[10px] ${status === "running" ? "text-[#3b6fd4]" : "text-slate-500"}`}>
          {status === "running" ? "● In progress" : "○ Pending"}
        </span>
      )}
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
