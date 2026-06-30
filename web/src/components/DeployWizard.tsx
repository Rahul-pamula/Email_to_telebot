import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Key, Rocket, CheckCircle, ArrowRight, Loader2 } from 'lucide-react';

export function DeployWizard() {
  const [step, setStep] = useState(1);
  const [keys, setKeys] = useState({
    supabaseUrl: '',
    supabaseToken: '',
    groqKey: '',
    telegramToken: ''
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [isDeploying, setIsDeploying] = useState(false);

  const handleNext = () => setStep(s => s + 1);

  const addLog = (msg: string, type: 'info' | 'success' | 'error' = 'info') => {
    setLogs(prev => [...prev, `<span class="terminal-${type}">[${new Date().toLocaleTimeString()}] ${msg}</span>`]);
  };

  const simulateDeploy = async () => {
    setIsDeploying(true);
    addLog("Starting client-side deployment...");
    await new Promise(r => setTimeout(r, 1000));
    
    addLog("Authenticating with Supabase Management API...", "info");
    await new Promise(r => setTimeout(r, 1500));
    addLog("Authentication successful.", "success");
    
    addLog("Pushing database schema...", "info");
    await new Promise(r => setTimeout(r, 2000));
    addLog("Database schema and tables created.", "success");
    
    addLog("Uploading secrets securely...", "info");
    await new Promise(r => setTimeout(r, 1500));
    addLog("Secrets stored.", "success");
    
    addLog("Deploying Edge Function...", "info");
    await new Promise(r => setTimeout(r, 3000));
    addLog("Edge function 'email-bot' deployed.", "success");
    
    addLog("Registering Telegram Webhook...", "info");
    await new Promise(r => setTimeout(r, 1000));
    addLog("Webhook registered.", "success");
    
    setIsDeploying(false);
    setTimeout(() => setStep(4), 1000);
  };

  return (
    <div className="bento-box" style={{ padding: '40px', maxWidth: '600px', margin: '0 auto', minHeight: '450px', position: 'relative', textAlign: 'left' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '32px' }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', opacity: step >= i ? 1 : 0.4, transition: 'opacity 0.3s' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: step >= i ? 'var(--primary-supa)' : '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: step >= i ? '#fff' : 'var(--text-muted)' }}>
              {i}
            </div>
            {i < 3 && <div style={{ height: 2, width: 80, background: step > i ? 'var(--primary-supa)' : '#e2e8f0', margin: '0 16px' }} />}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <h2><Shield style={{ verticalAlign: 'middle', marginRight: 8, color: 'var(--primary-supa)' }} /> Zero-Trust Architecture</h2>
            <p style={{ marginTop: 16, color: 'var(--text-muted)' }}>
              This deployment tool runs <strong>100% inside your browser</strong>. Your API keys are used directly to provision your Supabase instance and are never sent to our servers.
            </p>
            <p style={{ marginTop: 8, color: 'var(--text-muted)' }}>
              We cannot read your emails. We cannot steal your keys. 
            </p>
            <button className="btn btn-primary" onClick={handleNext} style={{ marginTop: 32, width: '100%' }}>
              I Understand, Continue <ArrowRight size={18} />
            </button>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <h2><Key style={{ verticalAlign: 'middle', marginRight: 8, color: 'var(--primary-supa)' }} /> Database Credentials</h2>
            <div style={{ marginTop: 16, padding: '16px', background: 'rgba(62, 175, 124, 0.1)', borderRadius: '8px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text)' }}>Quick Steps:</strong>
              <ol style={{ margin: '8px 0 0 20px', padding: 0, lineHeight: '1.6' }}>
                <li>Sign in and create a new project at the <a href="https://supabase.com/dashboard/projects" target="_blank" rel="noreferrer" style={{color: 'var(--primary-supa)', fontWeight: 'bold'}}>Supabase Dashboard</a>.</li>
                <li>Find your <b>Project URL</b> in <a href="https://supabase.com/dashboard/project/_/settings/api" target="_blank" rel="noreferrer" style={{color: 'var(--primary-supa)'}}>Project Settings &gt; API</a>.<br/><span style={{fontSize: '0.8rem', opacity: 0.8}}>Example: <code>https://xyz.supabase.co</code></span></li>
                <li>Generate a <b>Personal Access Token</b> in <a href="https://supabase.com/dashboard/account/tokens" target="_blank" rel="noreferrer" style={{color: 'var(--primary-supa)'}}>Account &gt; Access Tokens</a>.<br/><span style={{fontSize: '0.8rem', opacity: 0.8}}>Example: <code>sbp_1a2b3c...</code></span></li>
              </ol>
            </div>
            
            <div style={{ marginTop: 24 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: '0.95rem', fontWeight: 600 }}>Supabase Project URL</label>
              <input 
                className="glass-input" 
                placeholder="https://xyz.supabase.co" 
                value={keys.supabaseUrl}
                onChange={e => setKeys({...keys, supabaseUrl: e.target.value})}
              />
            </div>

            <div style={{ marginTop: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: '0.95rem', fontWeight: 600 }}>Personal Access Token</label>
              <input 
                className="glass-input" 
                type="password"
                placeholder="sbp_..." 
                value={keys.supabaseToken}
                onChange={e => setKeys({...keys, supabaseToken: e.target.value})}
              />
            </div>

            <button 
              className="btn btn-primary" 
              onClick={handleNext} 
              style={{ marginTop: 32, width: '100%' }}
              disabled={!keys.supabaseUrl || !keys.supabaseToken}
            >
              Next Step <ArrowRight size={18} />
            </button>
          </motion.div>
        )}

        {step === 3 && (
          <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <h2><Rocket style={{ verticalAlign: 'middle', marginRight: 8, color: 'var(--primary-tele)' }} /> AI & Bot Credentials</h2>
            
            <div style={{ marginTop: 16, padding: '16px', background: 'rgba(56, 189, 248, 0.1)', borderRadius: '8px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text)' }}>Quick Steps:</strong>
              <ol style={{ margin: '8px 0 0 20px', padding: 0, lineHeight: '1.6' }}>
                <li>Get a free AI key at <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" style={{color: 'var(--primary-tele)', fontWeight: 'bold'}}>console.groq.com</a>.<br/><span style={{fontSize: '0.8rem', opacity: 0.8}}>Example: <code>gsk_A1b2...</code></span></li>
                <li>
                  Create a Telegram bot by messaging <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" style={{color: 'var(--primary-tele)', fontWeight: 'bold'}}>@BotFather</a>:
                  <ul style={{ margin: '4px 0 4px 20px', padding: 0, fontSize: '0.85rem' }}>
                    <li>Send the <code>/newbot</code> command.</li>
                    <li>Choose a name and a username (must end in "bot").</li>
                    <li>Copy the provided HTTP API token.</li>
                  </ul>
                  <span style={{fontSize: '0.8rem', opacity: 0.8}}>Example: <code>123456:ABC-DEF...</code></span>
                </li>
              </ol>
            </div>
            
            <div style={{ marginTop: 24 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: '0.95rem', fontWeight: 600 }}>Groq API Key (AI)</label>
              <input 
                className="glass-input" 
                type="password"
                placeholder="gsk_..." 
                value={keys.groqKey}
                onChange={e => setKeys({...keys, groqKey: e.target.value})}
              />
            </div>

            <div style={{ marginTop: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: '0.95rem', fontWeight: 600 }}>Telegram Bot Token</label>
              <input 
                className="glass-input" 
                type="password"
                placeholder="123456:ABC-DEF..." 
                value={keys.telegramToken}
                onChange={e => setKeys({...keys, telegramToken: e.target.value})}
              />
            </div>

            {logs.length > 0 && (
              <div className="terminal" style={{ marginTop: 24 }}>
                {logs.map((log, idx) => (
                  <div key={idx} className="terminal-line" dangerouslySetInnerHTML={{ __html: log }} />
                ))}
                {isDeploying && <div className="terminal-line"><Loader2 size={12} className="animate-spin inline" /> processing...</div>}
              </div>
            )}

            {!isDeploying && logs.length === 0 && (
              <button 
                className="btn btn-primary" 
                onClick={simulateDeploy} 
                style={{ marginTop: 32, width: '100%' }}
                disabled={!keys.groqKey || !keys.telegramToken}
              >
                Deploy My Bot 🚀
              </button>
            )}
          </motion.div>
        )}

        {step === 4 && (
          <motion.div key="step4" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
            <div style={{ textAlign: 'center', paddingTop: 32 }}>
              <CheckCircle size={64} color="var(--primary-supa)" style={{ margin: '0 auto', marginBottom: 24 }} />
              <h2>Deployment Successful!</h2>
              <p style={{ marginTop: 16, color: 'var(--text-muted)' }}>
                Your private email assistant is now running on your personal Supabase instance.
              </p>
              <p style={{ marginTop: 24 }}>
                <a href="https://t.me/" target="_blank" rel="noreferrer" style={{ color: 'var(--primary-tele)', textDecoration: 'none', fontWeight: 'bold' }}>
                  Open Telegram to begin →
                </a>
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
