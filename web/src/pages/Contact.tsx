import { useEffect, useState } from 'react';
import { LandingFooter, LandingHeader } from './Landing';
import { useToast } from '../components/Toasts';

export function Contact() {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [sending, setSending] = useState(false);

  useEffect(() => { document.title = 'Contact — Rotisserie Draft'; }, []);

  const send = async () => {
    if (message.trim().length < 3) { toast('Please write a message first.', true); return; }
    setSending(true);
    try {
      const res = await fetch('/api/rd/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), message: message.trim(), website }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Sending failed');
      setName(''); setEmail(''); setMessage('');
      toast('Message sent. Thank you!');
    } catch (e) { toast((e as Error).message, true); }
    setSending(false);
  };

  return (
    <>
      <LandingHeader page="contact" />
      <div className="landing">
        <section className="contact2">
          <p className="eyebrow">Contact</p>
          <h1 className="pagetitle">Get in touch</h1>
          <p className="lead2">Questions, bug reports, or ideas? Send a message and you will hear
            back soon.</p>
          <div className="row">
            <div className="field"><label>Name (optional)</label>
              <input type="text" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label>Email (optional, for a reply)</label>
              <input type="text" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          </div>
          <input type="text" style={{ display: 'none' }} tabIndex={-1} autoComplete="off"
            value={website} onChange={(e) => setWebsite(e.target.value)} />
          <div className="field"><label>Message</label>
            <textarea maxLength={3000} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
          <button className="btn btn-primary" onClick={send} disabled={sending}>Send message</button>
        </section>
        <LandingFooter showAbout />
      </div>
    </>
  );
}
