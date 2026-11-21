import { useState, type FormEvent } from 'react'
import SplitText from '../components/kit/SplitText'

export default function Contact() {
  const [sent, setSent] = useState(false)
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // Sample portfolio: there is no backend to submit to — say so honestly.
    setSent(true)
  }
  return (
    <article className="pf-section">
      <div className="pf-container pf-narrow">
        <SplitText
          tag="h1"
          text="Contact"
          className="pf-page-title"
          splitType="chars"
          delay={70}
          duration={0.9}
          trigger="load"
          textAlign="left"
        />
        <p className="pf-lede" data-animate>
          Sample contact form — submitting shows the confirmation state; no
          message is sent anywhere.
        </p>
        {sent ? (
          <div className="pf-card pf-sent" role="status" data-animate>
            <h2 className="pf-h2">Message “sent”</h2>
            <p className="pf-body">
              This demo records nothing and sends nothing — in a real
              portfolio this form would reach Nova by email.
            </p>
            <button type="button" className="pf-btn pf-btn-ghost" onClick={() => setSent(false)}>
              Write another
            </button>
          </div>
        ) : (
          <form className="pf-form" onSubmit={onSubmit} data-animate>
            <label className="pf-field">
              <span>Name</span>
              <input name="name" type="text" required autoComplete="name" />
            </label>
            <label className="pf-field">
              <span>Email</span>
              <input name="email" type="email" required autoComplete="email" />
            </label>
            <label className="pf-field">
              <span>Message</span>
              <textarea name="message" rows={5} required />
            </label>
            <button type="submit" className="pf-btn pf-btn-primary">Send message</button>
          </form>
        )}
      </div>
    </article>
  )
}
