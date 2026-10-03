import { Clock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { InlineAlert, useToast } from '@/components/feedback/States'
import { FormField, Input } from '@/components/forms/Fields'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { DefinitionList } from '@/components/ui/Display'
import { fmt, todayISO } from '@/lib/status'
import { ApiError, errorMessage } from '@/services/api'
import { nowHM, omApi } from '../services/omApi'
import type { ClassRow } from '../types/om.types'
import { DelayReasonFields, type DelayState } from './DelayReasonDialog'

export function ClassFacts({ row, extra = [] }: { row: ClassRow; extra?: { label: string; value: React.ReactNode }[] }) {
  return (
    <DefinitionList
      columns={2}
      items={[
        { label: 'Professor', value: row.professor.full_name },
        { label: 'Subject', value: `${row.subject.name} · Lecture ${row.lecture_no}` },
        { label: 'Section', value: `Sem ${row.semester.replace('Semester ', '')}-${row.section} · ${row.branch_code}` },
        { label: 'Room', value: row.room ?? '—' },
        ...extra,
      ]}
    />
  )
}

export function RecordEntryDialog({ row, onClose, onSaved }: { row: ClassRow | null; onClose: () => void; onSaved: (row: ClassRow) => void }) {
  const toast = useToast()
  const [time, setTime] = useState('')
  const [delay, setDelay] = useState<DelayState | null>(null)
  const [reason, setReason] = useState('')
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isToday = row?.date === todayISO()

  useEffect(() => {
    if (!row) return
    // Today: the OM is standing at the door, so "now". A past class being back-filled: start from the scheduled time.
    setTime(row.entry_time ?? (row.date === todayISO() ? nowHM() : row.scheduled_start ?? ''))
    setDelay(null)
    setReason(row.delay_reason ?? '')
    setRemarks(row.delay_remarks ?? '')
    setError(null)
  }, [row])

  if (!row) return null

  const changeTime = (v: string) => {
    setTime(v)
    setDelay(null) // the backend re-judges the new time
    setError(null)
  }

  const save = async () => {
    if (!time) return setError('Enter the entry time.')
    setBusy(true)
    setError(null)
    try {
      const saved = await omApi.recordEntry(row.lecture_id, {
        time,
        ...(delay && reason ? { delay_reason: reason, delay_remarks: remarks.trim() || undefined } : {}),
      })
      toast('success', saved.timing_status === 'DELAYED' ? `Entry saved: ${fmt.clock(saved.entry_time)}, delayed ${saved.delay_minutes} min.` : `Entry saved: ${fmt.clock(saved.entry_time)}, on time.`)
      onSaved(saved)
      onClose()
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'DELAY_REASON_REQUIRED' || e.code === 'DELAY_REMARKS_REQUIRED')) {
        const d = e.details as { delay_minutes: number; tolerance_minutes: number }
        const first = !delay
        setDelay({ minutes: d.delay_minutes, tolerance: d.tolerance_minutes })
        setError(first ? null : e.code === 'DELAY_REMARKS_REQUIRED' ? 'Add remarks for “Other”.' : 'Select a delay reason.')
      } else setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={row.entry_time ? 'Correct entry time' : 'Record entry'}
      description={`${fmt.weekday(row.date)}, ${fmt.date(row.date)}`}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save} disabled={!!delay && (!reason || (reason === 'OTHER' && !remarks.trim()))}>Save entry</Button>
        </>
      }
    >
      <div className="space-y-4">
        <ClassFacts row={row} extra={[{ label: 'Scheduled start', value: <span className="tnum">{fmt.clock(row.scheduled_start)}</span> }, { label: 'Scheduled end', value: <span className="tnum">{fmt.clock(row.scheduled_end) || '—'}</span> }]} />
        <FormField label="Actual entry time" required htmlFor="entry-time">
          <div className="flex gap-2">
            <Input id="entry-time" type="time" className="tnum max-w-[9.5rem]" value={time} onChange={(e) => changeTime(e.target.value)} data-autofocus />
            {isToday && (
              <Button icon={<Clock className="h-4 w-4" />} onClick={() => changeTime(nowHM())}>Use current time</Button>
            )}
          </div>
        </FormField>
        {delay && <DelayReasonFields delay={delay} reason={reason} remarks={remarks} onReason={setReason} onRemarks={setRemarks} error={error} />}
        {error && !delay && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  )
}
