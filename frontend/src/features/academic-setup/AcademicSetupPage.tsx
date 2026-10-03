import type { ColumnDef } from '@tanstack/react-table'
import { useSearchParams } from '@/lib/router'
import { PageHeader, useBreadcrumbs } from '@/components/layout/PageHeader'
import { Badge, Tag } from '@/components/ui/Badge'
import { Tabs } from '@/components/ui/Tabs'
import { useAuth } from '@/features/auth/AuthContext'
import { useApi } from '@/hooks/useApi'
import { fmt } from '@/lib/status'
import type { Paged } from '@/services/api'
import { EntityManager } from './EntityManager'

type Year = { id: string; name: string; start_date: string; end_date: string; is_current: boolean }
type Sem = { id: string; academic_year_id: string; academic_year: string; number: number; name: string; start_date: string; end_date: string; is_current: boolean }
type Dept = { id: string; code: string; name: string }
type Branch = { id: string; department_id: string; department: string; code: string; name: string }
type Sec = { id: string; name: string; branch_id: string; branch: string; branch_code: string; semester_id: string; semester: string; academic_year: string; student_count: number | null }

type TabKey = 'years' | 'semesters' | 'departments' | 'branches' | 'sections'

const current = (v: boolean) => (v ? <Badge tone="success">Current</Badge> : null)

export function AcademicSetupPage() {
  useBreadcrumbs([{ label: 'Academic Management' }, { label: 'Academic Setup' }])
  const { can } = useAuth()
  const manage = can('academic.manage')
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as TabKey) || 'years'
  const years = useApi<Paged<Year>>('/academic-years').data?.items ?? []
  const depts = useApi<Paged<Dept>>('/departments').data?.items ?? []
  const branches = useApi<Paged<Branch>>('/branches').data?.items ?? []
  const sems = useApi<Paged<Sem>>('/semesters').data?.items ?? []

  return (
    <div>
      <PageHeader title="Academic Setup" description="The structure every teaching plan hangs from: academic year → semester → department / branch → section." />
      <div className="mb-5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-fg-label">
        {['Academic Year', 'Semester', 'Department / Branch', 'Section', 'Subject', 'Assigned Professor'].map((s, i, a) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <Tag>{s}</Tag>
            {i < a.length - 1 && <span aria-hidden>→</span>}
          </span>
        ))}
      </div>
      <Tabs
        className="mb-5"
        value={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        items={[
          { value: 'years', label: 'Academic Years', count: years.length },
          { value: 'semesters', label: 'Semesters', count: sems.length },
          { value: 'departments', label: 'Departments', count: depts.length },
          { value: 'branches', label: 'Branches', count: branches.length },
          { value: 'sections', label: 'Sections' },
        ]}
      />
      {tab === 'years' && (
        <EntityManager<Year>
          title="Academic years"
          addLabel="Add academic year"
          endpoint="/academic-years"
          canManage={manage}
          columns={[
            { header: 'Name', accessorKey: 'name', cell: ({ row: { original: y } }) => <span className="font-medium text-fg">{y.name}</span> },
            { header: 'Starts', accessorKey: 'start_date', cell: ({ getValue }) => fmt.date(getValue<string>()) },
            { header: 'Ends', accessorKey: 'end_date', cell: ({ getValue }) => fmt.date(getValue<string>()) },
            { header: 'Status', accessorKey: 'is_current', cell: ({ getValue }) => current(getValue<boolean>()) },
          ] as ColumnDef<Year, unknown>[]}
          fields={[
            { name: 'name', label: 'Name', required: true, placeholder: '2027–28', span: true },
            { name: 'start_date', label: 'Start date', type: 'date', required: true },
            { name: 'end_date', label: 'End date', type: 'date', required: true },
            { name: 'is_current', label: 'Current academic year', type: 'checkbox', hint: 'Shown in the top bar for every user.' },
          ]}
          toForm={(y) => ({ ...y })}
        />
      )}
      {tab === 'semesters' && (
        <EntityManager<Sem>
          title="Semesters"
          addLabel="Add semester"
          endpoint="/semesters"
          canManage={manage}
          columns={[
            { header: 'Semester', accessorKey: 'name', cell: ({ row: { original: s } }) => <span className="font-medium text-fg">{s.name}</span> },
            { header: 'Academic year', accessorKey: 'academic_year' },
            { header: 'Dates', accessorFn: (s) => s.start_date, cell: ({ row: { original: s } }) => `${fmt.date(s.start_date)} – ${fmt.date(s.end_date)}` },
            { header: 'Status', accessorKey: 'is_current', cell: ({ getValue }) => current(getValue<boolean>()) },
          ] as ColumnDef<Sem, unknown>[]}
          fields={[
            { name: 'academic_year_id', label: 'Academic year', type: 'select', required: true, options: years.map((y) => ({ value: y.id, label: y.name })) },
            { name: 'number', label: 'Semester number', type: 'number', required: true, hint: '1 to 12' },
            { name: 'start_date', label: 'Start date', type: 'date', required: true },
            { name: 'end_date', label: 'End date', type: 'date', required: true },
            { name: 'name', label: 'Display name', hint: 'Defaults to “Semester V” style', span: true },
            { name: 'is_current', label: 'Current semester', type: 'checkbox' },
          ]}
          toForm={(s) => ({ ...s })}
        />
      )}
      {tab === 'departments' && (
        <EntityManager<Dept>
          title="Departments"
          addLabel="Add department"
          endpoint="/departments"
          canManage={manage}
          columns={[
            { header: 'Code', accessorKey: 'code', cell: ({ getValue }) => <Tag>{getValue<string>()}</Tag> },
            { header: 'Name', accessorKey: 'name', cell: ({ getValue }) => <span className="font-medium text-fg">{getValue<string>()}</span> },
          ] as ColumnDef<Dept, unknown>[]}
          fields={[{ name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Name', required: true }]}
          toForm={(d) => ({ ...d })}
        />
      )}
      {tab === 'branches' && (
        <EntityManager<Branch>
          title="Branches"
          addLabel="Add branch"
          endpoint="/branches"
          canManage={manage}
          columns={[
            { header: 'Code', accessorKey: 'code', cell: ({ getValue }) => <Tag>{getValue<string>()}</Tag> },
            { header: 'Name', accessorKey: 'name', cell: ({ getValue }) => <span className="font-medium text-fg">{getValue<string>()}</span> },
            { header: 'Department', accessorKey: 'department' },
          ] as ColumnDef<Branch, unknown>[]}
          fields={[
            { name: 'department_id', label: 'Department', type: 'select', required: true, options: depts.map((d) => ({ value: d.id, label: d.name })), span: true },
            { name: 'code', label: 'Code', required: true },
            { name: 'name', label: 'Name', required: true },
          ]}
          toForm={(b) => ({ ...b })}
        />
      )}
      {tab === 'sections' && (
        <EntityManager<Sec>
          title="Sections"
          addLabel="Add section"
          endpoint="/sections"
          canManage={manage}
          columns={[
            { header: 'Section', accessorKey: 'name', cell: ({ getValue }) => <span className="font-medium text-fg">Section {getValue<string>()}</span> },
            { header: 'Branch', accessorKey: 'branch_code' },
            { header: 'Semester', accessorKey: 'semester' },
            { header: 'Academic year', accessorKey: 'academic_year' },
            { header: 'Students', accessorKey: 'student_count', meta: { align: 'right', className: 'tnum' } },
          ] as ColumnDef<Sec, unknown>[]}
          fields={[
            { name: 'branch_id', label: 'Branch', type: 'select', required: true, options: branches.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` })), span: true },
            { name: 'semester_id', label: 'Semester', type: 'select', required: true, options: sems.map((s) => ({ value: s.id, label: `${s.name} · ${s.academic_year}` })) },
            { name: 'name', label: 'Section name', required: true, placeholder: 'A' },
            { name: 'student_count', label: 'Students', type: 'number' },
          ]}
          toForm={(s) => ({ ...s })}
        />
      )}
    </div>
  )
}
