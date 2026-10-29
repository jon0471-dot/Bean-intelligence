'use client'

/**
 * BEAN Intelligence — account settings.
 * Profile, password, data retention note and account deletion (GDPR-style).
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { beanFetch, type BeanUser } from './shared'
import { Settings as SettingsIcon, KeyRound, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

export function Settings({ user, onUserChanged }: { user: BeanUser; onUserChanged: () => void }) {
  const router = useRouter()
  const [name, setName] = useState(user.name ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function saveProfile() {
    setBusy(true); setMsg(null)
    try {
      await beanFetch('/api/account/settings', { method: 'PATCH', json: { name } })
      setMsg({ tone: 'ok', text: 'Profile updated.' })
      onUserChanged()
    } catch (e) {
      setMsg({ tone: 'err', text: (e as Error).message })
    } finally { setBusy(false) }
  }

  async function changePassword() {
    setBusy(true); setMsg(null)
    try {
      await beanFetch('/api/account/settings', {
        method: 'PATCH',
        json: { currentPassword, newPassword },
      })
      setMsg({ tone: 'ok', text: 'Password changed.' })
      setCurrentPassword(''); setNewPassword('')
    } catch (e) {
      setMsg({ tone: 'err', text: (e as Error).message })
    } finally { setBusy(false) }
  }

  async function deleteAccount() {
    setBusy(true); setMsg(null)
    try {
      await beanFetch('/api/account/settings', { method: 'DELETE', json: { password: deletePassword } })
      router.refresh()
      window.location.reload()
    } catch (e) {
      setMsg({ tone: 'err', text: (e as Error).message })
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-6 flex items-center gap-2">
        <SettingsIcon className="h-5 w-5 text-[#d4af37]" />
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      </div>

      {msg ? (
        <div className={`mb-4 rounded-md border px-3 py-2 text-xs ${msg.tone === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
          {msg.text}
        </div>
      ) : null}

      <section className="bean-glass mb-5 rounded-xl p-5">
        <h2 className="mb-4 text-sm font-semibold text-white/85">Profile</h2>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="s-email" className="text-xs text-white/55">Email</Label>
            <Input id="s-email" value={user.email} disabled className="bg-black/30 opacity-60" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-name" className="text-xs text-white/55">Display name</Label>
            <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="bg-black/30" />
          </div>
          <Button onClick={() => void saveProfile()} disabled={busy} variant="outline" className="border-[rgba(212,175,55,0.4)] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.08)]">
            Save profile
          </Button>
        </div>
      </section>

      <section className="bean-glass mb-5 rounded-xl p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white/85">
          <KeyRound className="h-4 w-4 text-[#d4af37]" /> Change password
        </h2>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="s-cur" className="text-xs text-white/55">Current password</Label>
            <Input id="s-cur" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="bg-black/30" autoComplete="current-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-new" className="text-xs text-white/55">New password (8+ chars, letters & numbers)</Label>
            <Input id="s-new" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="bg-black/30" autoComplete="new-password" />
          </div>
          <Button onClick={() => void changePassword()} disabled={busy || !currentPassword || !newPassword} variant="outline" className="border-[rgba(212,175,55,0.4)] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.08)]">
            Update password
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-red-500/25 bg-red-500/5 p-5">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-300">
          <Trash2 className="h-4 w-4" /> Delete account
        </h2>
        <p className="mb-3 text-xs leading-relaxed text-white/50">
          Permanently removes your account, conversations, jobs and usage records. Generated image files are also deleted. This cannot be undone.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="border-red-500/40 text-red-300 hover:bg-red-500/10">Delete my account</Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="bean-glass border-red-500/30">
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm account deletion</AlertDialogTitle>
              <AlertDialogDescription>
                Enter your password to confirm. All your data will be permanently erased.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} placeholder="Password" className="bg-black/30" />
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); if (deletePassword) void deleteAccount() }}
                className="bg-red-500/90 text-white hover:bg-red-500"
              >
                Permanently delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </div>
  )
}
