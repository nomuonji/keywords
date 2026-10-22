import { useState } from 'react';
import { api } from './api';

type Kind = 'keyword' | 'idea' | 'seo_source' | 'seo_case';
type Props = {kind:Kind; id:string; label:string; revision?:number; onDeleted:()=>void}
  | {kind:'prune'; keepKeywords:string[]; onDeleted:()=>void};
type Preview = {deleted:false; preview:{total:number;deleteCount:number;keep:Array<{id:string;keyword:string}>;toDelete:Array<{id:string;keyword:string}>}};
type Deleted = {deleted:true;count?:number};
const ENDPOINT='/api/theme-research';

/** All destructive UI actions share the existing owner-only HttpOnly session. */
export function AdminDelete(props:Props) {
  const [loginRequired,setLoginRequired]=useState(false);
  const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [preview,setPreview]=useState<Preview['preview']|null>(null);
  const [ready,setReady]=useState(false);
  const isPrune=props.kind==='prune';
  const label=isPrune?'指定したキーワード以外を一括削除':'削除';

  async function ensureLogin() {
    const result=await api<{authenticated:boolean}>(ENDPOINT+'?resource=idea-session');
    if(result.authenticated)return true;
    setLoginRequired(true);return false;
  }
  async function login(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError('');
    try {
      await api(ENDPOINT,{method:'POST',body:JSON.stringify({action:'login',password})});
      setPassword('');setLoginRequired(false);setReady(true);
    } catch(e){setError(e instanceof Error?e.message:'ログイン失敗');}
    finally{setBusy(false);}
  }
  async function perform() {
    if(busy)return;
    setBusy(true);setError('');
    try {
      if(!ready && !await ensureLogin())return;
      if(isPrune){
        if(!preview){
          const result=await api<Preview>(ENDPOINT,{method:'POST',body:JSON.stringify({
            action:'prune-keywords',keepKeywords:props.keepKeywords
          })});
          setPreview(result.preview);return;
        }
        if(!window.confirm(preview.deleteCount+'件を削除し、'+preview.keep.map(x=>x.keyword).join('・')+'を残します。実行しますか？'))return;
        await api<Deleted>(ENDPOINT,{method:'POST',body:JSON.stringify({
          action:'prune-keywords',keepKeywords:props.keepKeywords,expectedDeleteCount:preview.deleteCount
        })});
      }else{
        if(!window.confirm('「'+props.label+'」を削除します。元に戻せません。よろしいですか？'))return;
        await api(ENDPOINT,{method:'POST',body:JSON.stringify({
          action:'delete-record',kind:props.kind,id:props.id,expectedLabel:props.label,
          ...(props.revision===undefined?{}:{expectedRevision:props.revision})
        })});
      }
      setPreview(null);props.onDeleted();
    } catch(e){setPreview(null);setReady(false);setError(e instanceof Error?e.message:'削除できませんでした');}
    finally{setBusy(false);}
  }
  return <span className="adminDeleteControl">
    <button type="button" disabled={busy} onClick={()=>void perform()} aria-label={label}>{busy?'処理中…':preview?'削除 '+preview.deleteCount+'件を確定':label}</button>
    {preview&&<small role="status">全{preview.total}件中、削除予定{preview.deleteCount}件／残す{preview.keep.map(x=>x.keyword).join('・')}。ボタンをもう一度押して確定してください。</small>}
    {loginRequired&&<form onSubmit={event=>void login(event)}>
      <label>削除操作には管理者認証が必要です
        <input type="password" autoComplete="current-password" required
          value={password} onChange={event=>setPassword(event.target.value)}
          placeholder="管理者アクセスキー" />
      </label>
      <button type="submit" disabled={busy}>ログイン</button>
    </form>}
    {error&&<small role="alert">{error}</small>}
  </span>;
}
