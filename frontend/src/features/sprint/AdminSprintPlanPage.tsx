import { CalendarPlus, ClipboardList, History, Lock, Pencil, Plus, Trash2, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { EmptyState, ErrorState, InlineAlert, LoadingRows, useToast } from '@/components/feedback/States'
import { PageHeader, useBreadcrumbs } from '@/components/layout/PageHeader'
import { Badge, StatusBadge, Tag } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { Metric, MetricStrip } from '@/components/ui/Display'
import { useApi } from '@/hooks/useApi'
import { adminSprintApi, mondayOf, type AdminSprintRow, type AdminWeek, type CarryForward } from '@/lib/api/sprint'
import { useSearchParams } from '@/lib/router'
import { EXECUTION_STATUS, fmt, todayISO } from '@/lib/status'
import { errorMessage } from '@/services/api'
import { cn } from '@/utils/cn'
import { changeTitle, describeSlot } from './components/ChangeDiff'
import { LectureDialog, type LectureDialogState } from './components/LectureDialog'
import { ReviewDialog } from './components/ReviewDialog'
import { WeekNav, weekLabel } from './components/WeekNav'

function LectureLine({ row, editing, onEdit, onCancel, onUndo }: { row: AdminSprintRow; editing: boolean; onEdit: () => void; onCancel: () => void; onUndo: () => void }) {
  const d = row.draft
  const cancelled = row.is_cancelled || d?.change_type === 'CANCEL'
  return (
    <li className={cn('grid grid-cols-1 gap-x-4 gap-y-2 border-b border-line-subtle px-4 py-3 last:border-0 lg:grid-cols-[150px_minmax(0,1.5fr)_minmax(0,1fr)_170px] lg:items-center', d && 'bg-warning/[0.04]')}>
      <div className={cn('tnum text-[13px] font-medium whitespace-nowrap text-fg', cancelled && 'text-fg-muted line-through')}>
        {fmt.timeRange(row.start, row.end) || 'Time not set'}
      </div>
      <div className="min-w-0">
        <div className={cn('text-[14px] font-semibold text-fg', cancelled && 'text-fg-muted line-through')}>
          {row.subject.name} <Tag className="ml-1 align-middle">{row.subject.code}</Tag>
        </div>
        <div className="mt-0.5 truncate text-[13px] text-fg-secondary">{row.lecture_no ? `Lecture ${row.lecture_no}: ` : ''}{row.topic}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {d && <Badge tone={d.change_type === 'CANCEL' ? 'danger' : d.change_type === 'ADD' ? 'success' : 'warning'}>Draft · {changeTitle(d)}</Badge>}
          {d?.moved_out && <Badge tone="info">Moves to {fmt.dateShort(d.new?.planned_date)}</Badge>}
          {!d && row.is_cancelled && <Badge tone="danger">Cancelled{row.revised?.revision_number ? ` · v${row.revised.revision_number}` : ''}</Badge>}
          {!d && !row.is_cancelled && row.revised && <span title={`Was: ${describeSlot(row.revised.old)} · ${row.revised.reason_label}`}><Badge tone="info">{row.revised.change_type === 'ADD' ? 'Added' : 'Updated'} · v{row.revised.revision_number}</Badge></span>}
          {row.origin === 'CARRY_FORWARD' && <Tag>Carry-forward</Tag>}
          {row.origin === 'SPRINT_ADDED' && <Tag>Added in sprint</Tag>}
          {row.execution_status !== 'SCHEDULED' && <StatusBadge value={row.execution_status} map={EXECUTION_STATUS} />}
        </div>
      </div>
      <div className="text-[13px] text-fg-secondary">
        <div className="font-medium text-fg-soft">{row.professor.full_name}</div>
        <div>Sem {row.semester.replace('Semester ', '')}-{row.section} · {row.room ? `Room ${row.room}` : 'Room not set'}</div>
      </div>
      <div className="flex items-center gap-1.5 lg:justify-end">
        {!editing ? null : d ? (
          <>
            {d.change_type !== 'CANCEL' && row.lecture_id && <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={onEdit}>Edit</Button>}
            <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={onUndo}>Undo</Button>
          </>
        ) : row.locked ? (
          <span className="inline-flex items-center gap-1 text-[12px] text-fg-muted" title={row.locked}><Lock className="h-3.5 w-3.5" /> Locked</span>
        ) : (
          <>
            <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={onEdit}>Edit</Button>
            <Button size="sm" variant="ghost" aria-label={`Cancel ${row.subject.name} lecture`} icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onCancel}>Cancel</Button>
          </>
        )}
      </div>
    </li>
  )
}

function CarryForwardPanel({ items, week, editing, onAdd, onDecide }: { items: CarryForward[]; week: AdminWeek; editing: boolean; onAdd: (c: CarryForward) => void; onDecide: (c: CarryForward, status: 'DEFERRED' | 'RESOLVED') => void }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, 5)
  return (
    <section className="panel mb-5" aria-label="Carry-forward">
      <div className="panel-header">
        <h2 className="panel-title">Carry-forward from earlier weeks · {items.length} item{items.length === 1 ? '' : 's'}</h2>
        <span className="meta">Suggested from what professors recorded. Nothing is scheduled until you add and publish it.</span>
      </div>
      {items.length === 0 ? (
        <p className="meta px-4 py-5">No incomplete topics from earlier weeks.</p>
      ) : (
        <ul>
          {shown.map((c) => (
            <li key={c.lecture_id} className="grid grid-cols-1 gap-x-4 gap-y-2 border-b border-line-subtle px-4 py-3 last:border-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px]">
                  <span className="font-semibold text-fg">{c.subject.short_name ?? c.subject.code} · Lecture {c.lecture_no}</span>
                  <span className="text-fg-secondary">{c.topic}</span>
                  <Badge tone={c.kind === 'PARTIAL' ? 'warning' : 'danger'}>{c.kind === 'PARTIAL' ? `${c.covered}/${c.total} covered` : 'Not conducted'}</Badge>
                  {c.status === 'DEFERRED' && <Badge tone="info">Rescheduled later</Badge>}
                  {c.draft_item_id && <Badge tone="success">Placed in this draft</Badge>}
                </div>
                <div className="mt-1 text-[13px] text-fg-soft">Remaining: {c.remaining.length ? c.remaining.join(' · ') : 'whole lecture'}</div>
                <div className="meta mt-0.5">{c.professor.full_name} · Sem {c.semester.replace('Semester ', '')}-{c.section} · was {fmt.weekday(c.date)} {fmt.dateShort(c.date)}{c.note ? ` · ${c.note}` : ''}</div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="primary" disabled={!editing || !!c.draft_item_id || week.week.is_past} title={!editing ? 'Start the sprint meeting update first' : undefined} icon={<CalendarPlus className="h-3.5 w-3.5" />} onClick={() => onAdd(c)}>
                  Add to this week
                </Button>
                <Button size="sm" disabled={!!c.draft_item_id || c.status === 'DEFERRED'} onClick={() => onDecide(c, 'DEFERRED')}>Reschedule later</Button>
                <Button size="sm" variant="ghost" disabled={!!c.draft_item_id} onClick={() => onDecide(c, 'RESOLVED')}>Mark resolved</Button>
              </div>
            </li>
          ))}
          {items.length > 5 && (
            <li className="px-4 py-2.5"><Button variant="link" className="text-[12.5px]" onClick={() => setAll((a) => !a)}>{all ? 'Show fewer' : `Show all ${items.length} items`}</Button></li>
          )}
        </ul>
      )}
    </section>
  )
}

/** Admin: one week of the semester plan, revised in a sprint meeting (draft -> review -> publish). */
export function AdminSprintPlanPage() {
  useBreadcrumbs([{ label: 'Teaching Management' }, { label: 'Weekly Sprint Plan' }])
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const weekStart = mondayOf(params.get('week') || todayISO())
  const go = (monday: string) => setParams(monday === mondayOf(todayISO()) ? {} : { week: monday }, { replace: true })
  const week = useApi<AdminWeek>('/admin/sprint-plan/week', { week_start: weekStart })
  const w = week.data
  const [dialog, setDialog] = useState<LectureDialogState | null>(null)
  const [review, setReview] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [busy, setBusy] = useState(false)
  const editing = !!w?.draft
  const total = w?.days.reduce((n, d) => n + d.lectures.length, 0) ?? 0

  const apply = (next: AdminWeek, message?: string) => {
    week.setData(next)
    if (message) toast('success', message)
  }
  const run = async (fn: () => Promise<AdminWeek>, message?: string) => {
    setBusy(true)
    try {
      apply(await fn(), message)
    } catch (e) {
      toast('danger', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const decide = async (c: CarryForward, status: 'DEFERRED' | 'RESOLVED') => {
    try {
      await adminSprintApi.decideCarryForward(c.lecture_id, status)
      toast('success', status === 'RESOLVED' ? 'Marked resolved.' : 'Kept for a later week.')
      void week.reload(true)
    } catch (e) {
      toast('danger', errorMessage(e))
    }
  }

  return (
    <div>
      <PageHeader
        title="Weekly Sprint Plan"
        description="The semester master plan, one week at a time. Revise the week in the sprint meeting, review the changes, then publish."
        actions={<ButtonLink to="/admin/sprint-history" icon={<History className="h-4 w-4" />}>Sprint history</ButtonLink>}
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <WeekNav week={w?.week} weekStart={weekStart} onChange={go} />
        {w && (
          <div className="flex flex-wrap items-center gap-2">
            <Tag>{w.version === 1 ? 'v1 · Semester master plan' : `v${w.version} · published ${fmt.dateTime(w.published?.published_at)}`}</Tag>
            {!editing && (
              <Button variant="primary" disabled={w.week.is_past || busy} title={w.week.is_past ? 'This week is over' : undefined} onClick={() => run(() => adminSprintApi.startMeeting(weekStart), 'Sprint meeting started. Changes stay in a draft until you publish.')}>
                Start sprint meeting update
              </Button>
            )}
          </div>
        )}
      </div>

      {week.error ? (
        <div className="panel"><ErrorState message={week.error.message} onRetry={week.reload} /></div>
      ) : !w ? (
        <div className="panel"><LoadingRows rows={6} /></div>
      ) : (
        <>
          {editing && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning-border bg-warning-soft px-4 py-3">
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold text-warning">Sprint meeting in progress · {weekLabel(w.week)}</div>
                <div className="text-[13px] text-fg-soft">
                  Weekly draft with {w.draft!.change_count} change{w.draft!.change_count === 1 ? '' : 's'}. Professors still see v{w.version} until you publish.
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => setDialog({ mode: 'add' })}>Add lecture</Button>
                <Button variant="ghost" onClick={() => setDiscard(true)}>Discard draft</Button>
                <Button variant="primary" onClick={() => setReview(true)}>Review changes ({w.draft!.change_count})</Button>
              </div>
            </div>
          )}

          <MetricStrip className="mb-5">
            <Metric label="Lectures this week" value={w.summary.lectures_planned} tone="neutral" sub={w.summary.cancelled ? `${w.summary.cancelled} cancelled` : undefined} />
            <Metric label="Completed" value={w.summary.completed} sub={`${w.summary.partially_completed} partial`} />
            <Metric label="Not conducted" value={w.summary.not_conducted} tone={w.summary.not_conducted ? 'danger' : 'neutral'} />
            <Metric label="Upcoming" value={w.summary.upcoming} tone="neutral" />
            <Metric label="Subtopics covered" value={`${w.summary.subtopics_covered}/${w.summary.subtopics_planned}`} tone="neutral" sub={`${w.summary.subtopics_remaining} remaining`} />
            <Metric label="Last week" value={`${w.previous_week.completed + w.previous_week.partially_completed}/${w.previous_week.lectures_planned}`} tone="neutral" sub={`delivered · ${w.previous_week.subtopics_remaining} subtopics left`} />
          </MetricStrip>

          <CarryForwardPanel items={w.carry_forward} week={w} editing={editing} onAdd={(c) => setDialog({ mode: 'add', carry: c })} onDecide={decide} />

          {total === 0 && !editing ? (
            <div className="panel">
              <EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No classes scheduled for this week" description="Publish a semester teaching plan with dates in this week, or move to another week." action={<ButtonLink to="/admin/plans" variant="primary">Open semester master plan</ButtonLink>} />
            </div>
          ) : (
            <div className="space-y-4">
              {w.days.map((day) => (
                <section key={day.date} className={cn('panel', day.date === w.today && 'border-primary-border')} aria-label={fmt.date(day.date)}>
                  <div className="panel-header">
                    <h2 className="flex items-center gap-2.5 text-[13px] font-semibold text-fg">
                      <span className="rounded-sm bg-surface-3 px-1.5 py-0.5 text-[11px] tracking-wide text-fg-secondary uppercase">{fmt.weekday(day.date)}</span>
                      {fmt.date(day.date)}
                      {day.date === w.today && <Badge tone="success" icon={false}>Today</Badge>}
                    </h2>
                    <div className="flex items-center gap-3">
                      <span className="meta">{day.lectures.length} lecture{day.lectures.length === 1 ? '' : 's'}</span>
                      {editing && day.date >= w.today && <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDialog({ mode: 'add', date: day.date })}>Add</Button>}
                    </div>
                  </div>
                  {day.lectures.length === 0 ? (
                    <p className="meta px-4 py-4">No lectures.</p>
                  ) : (
                    <ul>
                      {day.lectures.map((row) => (
                        <LectureLine
                          key={row.key}
                          row={row}
                          editing={editing}
                          onEdit={() => setDialog({ mode: 'edit', row })}
                          onCancel={() => setDialog({ mode: 'cancel', row })}
                          onUndo={() => run(() => adminSprintApi.removeChange(w.draft!.id, row.draft!.id), 'Change removed from the draft.')}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}
          {editing && !!w.conflicts?.length && (
            <div className="mt-4 space-y-2">
              {w.conflicts.map((c, i) => (
                <InlineAlert key={i} tone={c.level === 'ERROR' ? 'danger' : 'warning'} title={c.kind === 'PROFESSOR' ? 'Schedule conflict' : 'Room conflict'}>
                  {c.message}{c.level === 'ERROR' && ' This draft cannot be published until it is resolved.'}
                </InlineAlert>
              ))}
            </div>
          )}
          {!editing && w.week.is_past && <InlineAlert tone="info" className="mt-4">This week is over, so it can no longer be revised. Incomplete topics appear under carry-forward in the next week&apos;s meeting.</InlineAlert>}

          <LectureDialog state={dialog} week={w} onClose={() => setDialog(null)} onSaved={apply} />
          <ReviewDialog
            open={review}
            week={w}
            onClose={() => setReview(false)}
            onRemoved={(next) => apply(next)}
            onPublished={(r) => {
              setReview(false)
              toast('success', `Published v${r.revision.revision_number} for ${weekLabel(w.week)}. Professors now see the updated schedule.`)
              void week.reload()
            }}
          />
          <ConfirmDialog open={discard} onClose={() => setDiscard(false)} tone="danger" title="Discard this draft?" confirmLabel="Discard draft"
            onConfirm={async () => { await run(() => adminSprintApi.discard(w.draft!.id), 'Draft discarded. The published schedule was not changed.'); setDiscard(false) }}>
            {w.draft?.change_count ?? 0} unpublished change{w.draft?.change_count === 1 ? '' : 's'} will be thrown away. The published schedule stays as it is.
          </ConfirmDialog>
        </>
      )}
    </div>
  )
}
