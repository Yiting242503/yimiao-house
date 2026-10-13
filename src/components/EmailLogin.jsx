import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Check, LoaderCircle, LockKeyhole, Pencil, Send } from 'lucide-react';
import { api } from '../api.js';
import './EmailLogin.css';

export default function EmailLogin({ ready = true, onSuccess }) {
  const id = useId();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [requested, setRequested] = useState(false);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const codeInput = useRef(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    tick();
    if (!resendAt) return undefined;
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [resendAt]);

  useEffect(() => {
    if (requested && !busy && !verified) codeInput.current?.focus();
  }, [requested, busy, verified]);

  const finishEntry = async () => {
    setStatus('登录已确认，正在打开小屋');
    try {
      await onSuccess?.();
    } catch (failure) {
      if (mounted.current) {
        setError(failure.message || '小屋暂时没有打开，请再试一次。');
        setStatus('登录已确认');
      }
    }
  };

  const requestCode = async () => {
    if (!ready || inFlight.current || Date.now() < resendAt) return;
    const address = email.trim().toLowerCase();
    if (!address) { setError('请填写登录邮箱。'); return; }
    inFlight.current = true;
    setBusy('request');
    setError('');
    setStatus('正在请求验证码');
    try {
      await api('/auth/request-code', 'POST', { email: address });
      if (mounted.current) {
        setEmail(address);
        setRequested(true);
        setResendAt(Date.now() + 60000);
        setStatus('验证码请求已提交');
      }
    } catch (failure) {
      if (mounted.current) {
        setError(failure.message || '验证码请求未完成，请重试。');
        setStatus('');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy('');
    }
  };

  const verifyCode = async () => {
    if (!ready || inFlight.current) return;
    if (!/^[0-9]{6}$/.test(code)) { setError('请填写六位验证码。'); return; }
    inFlight.current = true;
    setBusy('verify');
    setError('');
    setStatus('正在确认验证码');
    try {
      await api('/auth/verify-code', 'POST', { email: email.trim().toLowerCase(), code });
      if (!mounted.current) return;
      setVerified(true);
      setCode('');
      await finishEntry();
    } catch (failure) {
      if (mounted.current) {
        setError(failure.message || '验证码没有确认成功，请重试。');
        setStatus('');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy('');
    }
  };

  const retryEntry = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy('enter');
    setError('');
    try { await finishEntry(); }
    finally {
      inFlight.current = false;
      if (mounted.current) setBusy('');
    }
  };

  const changeEmail = () => {
    if (inFlight.current) return;
    setRequested(false);
    setCode('');
    setError('');
    setStatus('');
  };

  return <form className="email-login" onSubmit={event => {
    event.preventDefault();
    if (verified) retryEntry();
    else if (requested) verifyCode();
    else requestCode();
  }} aria-busy={!!busy}>
    <fieldset className="email-login-fields" disabled={!ready || !!busy}>
      <legend className="email-login-legend"><LockKeyhole size={16} /> 登录小屋</legend>
      {verified ? <div className="email-login-confirmed"><Check size={22} /><span>登录已确认</span></div> : <>
        {requested ? <div className="email-login-address"><div><span>登录邮箱</span><strong>{email}</strong></div><button type="button" className="email-login-change" onClick={changeEmail} title="更换邮箱"><Pencil size={15} /><span>更换</span></button></div> : <label className="email-login-field" htmlFor={`${id}-email`}><span>邮箱</span><input id={`${id}-email`} type="email" name="email" value={email} onChange={event => { setEmail(event.target.value); setError(''); }} autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} required maxLength={254} placeholder="你的登录邮箱" aria-describedby={error ? `${id}-error` : undefined} /></label>}
        {requested && <label className="email-login-field" htmlFor={`${id}-code`}><span>验证码</span><input ref={codeInput} id={`${id}-code`} className="email-login-code" name="oneTimeCode" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => { setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 6)); setError(''); }} placeholder="六位验证码" aria-describedby={error ? `${id}-error` : undefined} /></label>}
      </>}
      <button className="button email-login-submit" type="submit" disabled={!ready || !!busy || (!requested && !verified && remaining > 0)}>
        {busy ? <LoaderCircle size={17} className="spin" /> : verified ? <ArrowRight size={17} /> : requested ? <LockKeyhole size={17} /> : <Send size={17} />}
        <span>{busy === 'request' ? '正在发送' : busy ? '正在进入' : verified ? '进入小屋' : requested ? '确认并进入小屋' : remaining > 0 ? `${remaining} 秒后可发送` : '发送验证码'}</span>
      </button>
      {requested && !verified && <button className="email-login-resend" type="button" disabled={remaining > 0 || !!busy || !ready} onClick={requestCode}><Send size={14} /><span>{remaining > 0 ? `${remaining} 秒后可重新发送` : '重新发送验证码'}</span></button>}
    </fieldset>
    {!ready && <p className="email-login-status" role="status">邮箱登录暂未连接，请稍后再试</p>}
    {ready && status && <p className="email-login-status" role="status" aria-live="polite">{status}</p>}
    {error && <p id={`${id}-error`} className="email-login-error" role="alert">{error}</p>}
  </form>;
}
