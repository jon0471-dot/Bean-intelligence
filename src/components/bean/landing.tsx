'use client'

/**
 * BEAN Intelligence — landing & authentication view.
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner, beanFetch, type BeanUser } from './shared'
import { MessageSquareText, Image as ImageIcon, Video, Code2, ShieldCheck, Route, Gauge } from 'lucide-react'

const PRODUCTS = [
  { name: 'RIISHE', desc: 'Conversational intelligence — chat, reasoning, writing, multilingual.', icon: MessageSquareText },
  { name: 'LAXII', desc: 'Image generation studio — prompts to polished visuals, downloadable.', icon: ImageIcon },
  { name: 'JAZMII', desc: 'Video generation engine — async jobs with truthful availability.', icon: Video },
  { name: 'CODE GIFTZ', desc: 'Coding intelligence — generate, review, and run tests in a sandbox.', icon: Code2 },
]

export function Landing({ onAuthed }: { onAuthed: (u: BeanUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
      const payload = mode === 'login' ? { email, password } : { email, password, name: name || undefined }
      const d = await beanFetch<{ user: BeanUser }>(path, { method: 'POST', json: payload })
      onAuthed(d.user)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-[rgba(212,175,55,0.12)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <BeanMark className="h-8 w-8" />
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-[0.22em] bean-gold-text">BEAN</div>
              <div className="text-[10px] tracking-[0.34em] text-white/45">INTELLIGENCE</div>
            </div>
          </div>
          <div className="text-xs text-white/40 hidden sm:block">Brand-owned AI platform</div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-6 py-12 lg:grid-cols-2 lg:py-20">
        <section>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[rgba(212,175,55,0.25)] bg-[rgba(212,175,55,0.06)] px-3 py-1 text-[11px] tracking-wide text-[#f0c75e]">
            <ShieldCheck className="h-3.5 w-3.5" /> Private multi-model backend
          </div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            One platform. <span className="bean-gold-text">Four flagship</span> AI products.
          </h1>
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-white/60">
            BEAN Intelligence runs its own products, experience and routing on top of authorized
            inference backends. You choose a BEAN product — never an upstream model — and every
            status you see is real.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {PRODUCTS.map((p) => (
              <div key={p.name} className="bean-glass bean-glass-hover rounded-xl p-4">
                <div className="mb-1.5 flex items-center gap-2">
                  <p.icon className="h-4 w-4 text-[#d4af37]" />
                  <span className="text-sm font-semibold tracking-wide">{p.name}</span>
                </div>
                <p className="text-xs leading-relaxed text-white/50">{p.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-5 text-[11px] text-white/40">
            <span className="inline-flex items-center gap-1.5"><Route className="h-3.5 w-3.5 text-[#d4af37]/70" /> Server-side product routing</span>
            <span className="inline-flex items-center gap-1.5"><Gauge className="h-3.5 w-3.5 text-[#d4af37]/70" /> Quotas & usage metering</span>
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-[#d4af37]/70" /> Truthful job status</span>
          </div>
        </section>

        <section className="lg:justify-self-end w-full max-w-md">
          <Card className="bean-glass border-[rgba(212,175,55,0.18)]">
            <CardContent className="p-6">
              <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-black/40 p-1">
                {(['login', 'register'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setMode(m); setError(null) }}
                    className={`rounded-md py-2 text-xs font-medium tracking-wide transition-colors ${
                      mode === m ? 'bg-[rgba(212,175,55,0.16)] text-[#f0c75e]' : 'text-white/50 hover:text-white/80'
                    }`}
                  >
                    {m === 'login' ? 'Sign in' : 'Create account'}
                  </button>
                ))}
              </div>

              <form onSubmit={submit} className="space-y-4">
                {mode === 'register' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="name" className="text-xs text-white/60">Name (optional)</Label>
                    <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" className="bg-black/30" maxLength={80} />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs text-white/60">Email</Label>
                  <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="bg-black/30" autoComplete="email" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-xs text-white/60">Password</Label>
                  <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'register' ? '8+ chars, letters and numbers' : '••••••••'} className="bg-black/30" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
                </div>

                {error ? (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
                ) : null}

                <Button type="submit" disabled={busy} className="w-full bg-[#d4af37] font-semibold text-black hover:bg-[#e6c25a]">
                  {busy ? <Spinner className="border-black/30 border-t-black" /> : null}
                  {mode === 'login' ? 'Sign in to BEAN' : 'Create your account'}
                </Button>

                {mode === 'register' ? (
                  <p className="text-center text-[11px] leading-relaxed text-white/35">
                    The first account created becomes the platform administrator.
                  </p>
                ) : null}
              </form>
            </CardContent>
          </Card>
        </section>
      </main>

      <footer className="mt-auto border-t border-[rgba(212,175,55,0.1)] py-5">
        <div className="mx-auto max-w-6xl px-6 text-center text-[11px] text-white/35">
          BEAN Intelligence owns its products and experience. Inference is provided by authorized,
          licensed backends — upstream foundation models are not claimed as BEAN-trained.
        </div>
      </footer>
    </div>
  )
}

export function BeanMark({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#0d0d10" stroke="rgba(212,175,55,0.35)" />
      <ellipse cx="16" cy="16" rx="9" ry="7" fill="none" stroke="#d4af37" strokeWidth="2.2" transform="rotate(-18 16 16)" />
      <path d="M9.5 19.5 Q16 15 22.5 12.5" stroke="#f0c75e" strokeWidth="1.5" fill="none" transform="rotate(-18 16 16)" />
    </svg>
  )
}
