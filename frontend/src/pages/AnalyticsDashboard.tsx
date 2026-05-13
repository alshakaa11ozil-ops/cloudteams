// src/pages/AnalyticsDashboard.tsx
// FIXES APPLIED:
//   - null guard on uploadsPerDay before format()
//   - "Active Members" → "Active Contributors"
//   - fileCount field verified against AnalyticsResult type

import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchAnalytics } from '@/api/files'
import {
  PieChart, Pie, Cell, Tooltip as RechartsTooltip,
  Legend, ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid
} from 'recharts'
import { format } from 'date-fns'

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6366F1', '#14B8A6']

export default function AnalyticsDashboard() {
  const { id } = useParams<{ id: string }>()
  const teamId = parseInt(id || '0', 10)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics', teamId],
    queryFn: () => fetchAnalytics(teamId),
    enabled: teamId > 0,
    staleTime: 60_000, // analytics don't need real-time — 1 minute cache
  })

  if (isLoading) {
    return <div className="flex items-center justify-center h-full bg-gray-50 flex-1"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
  }
  if (isError || !data) {
    return <div className="flex items-center justify-center h-full bg-gray-50 text-red-500 flex-1">Failed to load analytics data.</div>
  }

  const simplifyMimeType = (mime: string) => {
    if (!mime) return 'UNKNOWN'
    if (mime === 'application/pdf') return 'PDF'
    if (mime.includes('wordprocessingml')) return 'DOCX'
    if (mime.includes('spreadsheetml')) return 'XLSX'
    if (mime.includes('presentationml')) return 'PPTX'
    if (mime.includes('image/')) return mime.split('/')[1].toUpperCase()
    if (mime.includes('text/')) return mime.split('/')[1].toUpperCase()
    return mime.split('/').pop()?.split('.').pop()?.toUpperCase() || 'FILE'
  }

  const fileTypeData = (data.fileTypes || []).map(ft => ({
    name: simplifyMimeType(ft.mime_type),
    value: ft.count || 0,
  }))

  // FIX: filter out null days before calling format()
  // A null day would cause format() to throw and crash the chart
  const uploadData = (data.uploadsPerDay || [])
    .filter(ud => ud && ud.day != null)
    .map(ud => ({
      date: format(new Date(ud.day), 'MMM d'),
      uploads: ud.count || 0,
    }))

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-y-auto w-full custom-scrollbar">
      <div className="px-8 py-8 max-w-7xl mx-auto w-full space-y-8">

        <div>
          <h1 className="text-2xl font-bold text-slate-900">Analytics Insights</h1>
          <p className="text-sm text-slate-500 mt-1">Storage and activity overview for your team</p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatCard label="Total Storage Used" value={data.storage?.totalBytesFormatted || '0 B'} badge="UNLIMITED CAPACITY" badgeColor="blue" />
          <StatCard label="Total Files" value={String(data.storage?.fileCount || 0)} />
          {/* FIX: "Active Contributors" — memberActivity only counts users who acted,
              not all team members. "Active Members" was misleading. */}
          <StatCard label="Active Contributors" value={String((data.memberActivity || []).length)} />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm flex flex-col items-center">
            <h2 className="text-lg font-bold text-slate-800 mb-6 self-start">File Types Distribution</h2>
            <div className="w-full h-72">
              {fileTypeData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <PieChart>
                    <Pie data={fileTypeData} cx="50%" cy="50%" innerRadius={70} outerRadius={100} paddingAngle={5} dataKey="value">
                      {fileTypeData.map((_e, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <RechartsTooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '13px', fontWeight: 'bold' }} formatter={(val: any) => [`${val} files`, 'Count']} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-400 italic">No files found.</div>
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm flex flex-col">
            <h2 className="text-lg font-bold text-slate-800 mb-6">Uploads (Last 30 Days)</h2>
            <div className="w-full h-72">
              {uploadData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <BarChart data={uploadData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11, fontWeight: 500 }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11, fontWeight: 500 }} />
                    <RechartsTooltip cursor={{ fill: '#F8FAFC' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '13px', fontWeight: 'bold' }} />
                    <Bar dataKey="uploads" fill="#3B82F6" radius={[4, 4, 0, 0]} barSize={32} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-400 italic">No upload history.</div>
              )}
            </div>
          </div>
        </div>

        {/* Tables */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
              <h2 className="text-base font-bold text-slate-800">Most Active Folders</h2>
            </div>
            <table className="w-full text-sm text-left">
              <thead className="text-[11px] text-slate-400 uppercase bg-slate-50/50 tracking-wider">
                <tr><th className="px-6 py-3 font-bold">Folder Name</th><th className="px-6 py-3 font-bold text-right">Files</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data.topFolders || []).length > 0 ? (data.topFolders || []).map(f => (
                  <tr key={f.folder_id} className="hover:bg-blue-50/50 transition-colors">
                    <td className="px-6 py-4 font-semibold text-slate-700 flex items-center gap-2">
                      <svg className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>
                      {f.folder_name}
                    </td>
                    <td className="px-6 py-4 text-right font-medium text-slate-600">{f.file_count}</td>
                  </tr>
                )) : <tr><td colSpan={2} className="px-6 py-8 text-center text-slate-400 italic">No folders available</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
              <h2 className="text-base font-bold text-slate-800">Top Contributors</h2>
            </div>
            <table className="w-full text-sm text-left">
              <thead className="text-[11px] text-slate-400 uppercase bg-slate-50/50 tracking-wider">
                <tr><th className="px-6 py-3 font-bold">Member</th><th className="px-6 py-3 font-bold text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.memberActivity.length > 0 ? data.memberActivity.map((m, idx) => (
                  <tr key={m.user_id} className="hover:bg-blue-50/50 transition-colors">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${idx === 0 ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                          {m.username.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-700">{m.username}</span>
                          <span className="text-[11px] font-medium text-slate-400">{m.email}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="inline-flex items-center justify-center px-2.5 py-1 text-xs font-bold text-blue-800 bg-blue-100 rounded-full">{m.action_count}</span>
                    </td>
                  </tr>
                )) : <tr><td colSpan={2} className="px-6 py-8 text-center text-slate-400 italic">No activity recorded</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}

function StatCard({ label, value, badge, badgeColor = 'blue' }: { label: string; value: string; badge?: string; badgeColor?: string }) {
  return (
    <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-center transition-shadow hover:shadow-md">
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{label}</h3>
      <span className="text-4xl font-extrabold text-slate-800">{value}</span>
      {badge && <div className={`mt-3 text-[10px] font-bold text-${badgeColor}-500 bg-${badgeColor}-50 self-start px-2 py-1 rounded`}>{badge}</div>}
    </div>
  )
}