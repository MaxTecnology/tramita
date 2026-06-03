import { useEffect } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { LayoutDashboard, Building2, CreditCard, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function MasterLayout() {
  const { user, isAuthenticated, logout } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'MASTER') {
      navigate('/login', { replace: true })
    }
  }, [isAuthenticated, user, navigate])

  if (!isAuthenticated || user?.role !== 'MASTER') return null

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-56 bg-[#0C447C] flex flex-col flex-shrink-0">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-[#185FA5]">
          <div className="flex items-center gap-2.5">
            <HubIcon />
            <div>
              <p className="text-white font-bold text-sm leading-tight">AutoHubs</p>
              <p className="text-[#85B7EB] text-xs">Master</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          <MasterLink to="/master/dashboard" icon={<LayoutDashboard size={16} />} label="Dashboard" />
          <MasterLink to="/master/plans" icon={<CreditCard size={16} />} label="Planos" />
          <MasterLink to="/master/organizations" icon={<Building2 size={16} />} label="Escritórios" />
        </nav>

        {/* User + logout */}
        <div className="px-3 py-4 border-t border-[#185FA5]">
          <p className="text-[#B5D4F4] text-xs px-3 mb-2 truncate">{user?.name}</p>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-[#85B7EB] hover:bg-[#185FA5] hover:text-white transition-colors"
          >
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}

function MasterLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-[#185FA5] text-white font-medium'
            : 'text-[#B5D4F4] hover:bg-[#185FA5] hover:text-white',
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}

function HubIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="36" cy="36" r="10" fill="white" />
      <circle cx="36" cy="10" r="5" fill="white" opacity="0.8" />
      <circle cx="60" cy="51" r="5" fill="white" opacity="0.8" />
      <circle cx="12" cy="51" r="5" fill="white" opacity="0.8" />
      <line x1="36" y1="26" x2="36" y2="15" stroke="white" strokeWidth="2" opacity="0.6" />
      <line x1="46" y1="42" x2="55" y2="46" stroke="white" strokeWidth="2" opacity="0.6" />
      <line x1="26" y1="42" x2="17" y2="46" stroke="white" strokeWidth="2" opacity="0.6" />
    </svg>
  )
}
