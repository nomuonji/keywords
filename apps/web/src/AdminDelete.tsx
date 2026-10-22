import { useState, type FormEvent } from 'react';
import { api } from './api';

type Kind = 'keyword' | 'idea' | 'seo_source' | 'seo_case';
type Target = {id:string;keyword:string};
type Props =
  | {kind:Kind;id:string;label:string;revision?:number;onDeleted:()=>void}
  | {kind:'selected-keywords';targets:Target[];onDeleted:()=>void};
type Preview = {total:number;deleteCount:number;toDelete:Target[]};
const ENDPOINT='/api/theme-research';

/** All destructive UI actions share the existing owner-only HttpOnly session. */
export function AdminDelete(props:Props) {
  const [loginRequired,setLoginRequired]=useState(false);
  const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [preview,setPreview]=useState<Preview|null>(null);
  const [ready,setReady]=useState(false);
  const isBulk=props.kind==='selected-keywords';
  const label=isBulk?`選択した${props.targets.length}件を削除`:'削除';

  async function ensureLogin() {
    const result=await api<{authenticated:boolean}>(ENDPOINT+'?resource=idea-session');
    if(result.authenticated)return true;
    setLoginRequired(true);return false;
  }
  async function login(event:FormEvent<HTMLFormElement>) {
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
      if(props.kind==='selected-keywords'){
        const targets=props.targets.map(x=>({id:x.id,expectedLabel:x.keyword}));
        if(!targets.length)return;
        if(!preview){
          const result=await api<{deleted:false;preview:Preview}>(ENDPOINT,{method:'POST',body:JSON.stringify({
            action:'delete-selected-keywords',targets
          })});
          setPreview(result.preview);return;
        }
        if(preview.deleteCount!==targets.length || 
           preview.toDelete.some(item=>!targets.some(x=>x.id===item.id&&x.expectedLabel===item.keyword))) {
          setPreview(null);throw new Error('選択内容が変わりました。再度プレビューを確認してください。');
        }
        if(!window.confirm(`選択した${preview.deleteCount}件を完全に削除します。削除対象のサイト構想内の参照は外しますが、サイト構想自体は残します。取り消せません。実行しますか？`))return;
        await api(ENDPOINT,{method:'POST',body:JSON.stringify({
          action:'delete-selected-keywords',targets,expectedDeleteCount:preview.deleteCount
        })});
      } else {
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
  return <div className="adminDeleteControl">
    <button type="button" disabled={busy||(isBulk&&props.targets.length===0)} onClick={()=>void perform()} aria-label={label}>
      {busy?'処理中…':preview?`削除${preview.deleteCount}件を確定`:label}
    </button>
    {preview&&<div role="status">
      <small>登録全{preview.total}件中、選択した{preview.deleteCount}件だけを削除します。対象を確認し、もう一度ボタンを押して確定してください。</small>
      <details><summary>削除対象{preview.deleteCount}件を確認</summary>
        <div style={{maxHeight:240,overflowY:'auto'}}><ul>
          {preview.toDelete.map(item=><li key={item.id}>{item.keyword}</li>)}
        </ul></div>
      </details>
    </div>}
    {loginRequired&&<form onSubmit={event=>void login(event)}>
      <label>削除操作には管理者認証が必要です
        <input type="password" autoComplete="current-password" required
          value={password} onChange={event=>setPassword(event.target.value)}
          placeholder="管理者アクセスキー" />
      </label>
      <button type="submit" disabled={busy}>ログイン</button>
    </form>}
    {error&&<small role="alert">{error}</small>}
  </div>;
}
