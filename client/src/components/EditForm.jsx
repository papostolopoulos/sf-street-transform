import React, { useEffect, useRef, useState } from 'react';

/*
  Unified editing form for Zone and Street Segment objects.
  Props:
    mode: 'zone' | 'street'
    name: string
    description: string
    useType: string
    onNameChange: (v)=>void
    onDescriptionChange: (v)=>void
    onTypeChange: (t)=>void
    onCancel: ()=>void
    onSave: ()=>void
    savingLabel?: string (default: 'Save changes')
    cancelLabel?: string (default: 'Cancel')
    note?: ReactNode (optional informational banner inside form top)
    colorByUse: record useType->color (for type buttons)
    buttonVariants: styling object with .success and .outline
*/

export default React.memo(function EditForm({
  mode,
  name,
  description,
  useType,
  onNameChange,
  onDescriptionChange,
  onTypeChange,
  onCancel,
  onSave,
  savingLabel = 'Save changes',
  cancelLabel = 'Cancel',
  note,
  colorByUse,
  buttonVariants,
  typeOptions = ['mixed-use','residential','commercial'],
  originalName,
  originalDescription,
  originalUseType,
  autoFocus = true,
  onAfterAction = () => {},
}) {
  const formIdPrefix = mode === 'zone' ? 'zone' : 'street';
  const nameRef = useRef(null);
  const [touched, setTouched] = useState(false);
  const [attemptedSave, setAttemptedSave] = useState(false);

  const nameChanged = originalName != null && name !== originalName;
  const descChanged = originalDescription != null && (description||'') !== (originalDescription||'');
  const typeChanged = originalUseType != null && useType !== originalUseType;

  const nameValid = name.trim().length > 0;
  const canSave = nameValid;

  useEffect(()=>{
    if (autoFocus && nameRef.current) {
      nameRef.current.focus();
      nameRef.current.select();
    }
  },[autoFocus]);

  function handleKey(e){
    if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); attemptSave(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); attemptSave(); }
  }

  function attemptSave(){
    setAttemptedSave(true);
    if (!canSave) return;
    onSave();
    onAfterAction('save');
  }

  return (
    <form onSubmit={(e)=>{e.preventDefault(); attemptSave();}} onKeyDown={handleKey} style={{ display:'grid', gap:'0.55rem' }} aria-label={`${mode === 'zone' ? 'Zone' : 'Street segment'} edit form`}>
      {note}
      <label htmlFor={`${formIdPrefix}-edit-name`} style={labelStyle}>Name</label>
      <input
        ref={nameRef}
        id={`${formIdPrefix}-edit-name`}
        value={name}
        onChange={e=>{ setTouched(true); onNameChange(e.target.value); }}
        placeholder={mode === 'zone' ? 'Custom Zone' : 'Segment Name'}
        style={{ ...inputStyle, ...(nameChanged ? changedStyle : null), borderColor: !nameValid && attemptedSave ? '#dc3545' : (nameChanged ? '#28a745' : '#ccc') }}
        aria-invalid={!nameValid && attemptedSave}
      />
      {!nameValid && attemptedSave && (
        <div style={{ fontSize:'0.65rem', color:'#dc3545', marginTop:'-0.3rem' }}>Name is required.</div>
      )}
      <label htmlFor={`${formIdPrefix}-edit-description`} style={labelStyle}>Description</label>
      <textarea
        id={`${formIdPrefix}-edit-description`}
        value={description || ''}
        onChange={e=>onDescriptionChange(e.target.value)}
        rows={3}
        placeholder={mode === 'zone' ? 'Notes, purpose, constraints' : 'Optional description'}
        style={{ ...textareaStyle, ...(descChanged ? changedStyle : null) }}
      />
      <div style={{ display:'flex', alignItems:'center', gap:'0.6rem', flexWrap:'wrap', marginTop:'0.15rem' }}>
        <span style={{ fontSize:'0.75rem', fontWeight:600 }}>Type:</span>
        {typeOptions.map(t => (
          <button key={t} type="button" onClick={()=>onTypeChange(t)} title={t} aria-label={`Set type ${t}`} style={{ width:30, height:30, borderRadius:6, border: useType === t ? '2px solid #222' : '1px solid #bbb', background: colorByUse[t], cursor:'pointer', boxShadow: useType === t ? '0 0 0 2px rgba(0,0,0,0.25)' : 'none', ...(typeChanged && useType === t ? changedStyle : null) }} />
        ))}
      </div>
      <div style={{ display:'flex', gap:'0.6rem', flexWrap:'wrap', marginTop:'0.25rem' }}>
        <button type="submit" className="btn btn--save" style={{ ...buttonVariants.success, opacity: canSave ? 1 : 0.6, cursor: canSave ? 'pointer':'not-allowed' }} disabled={!canSave}>{savingLabel}</button>
  <button type="button" onClick={()=>{ onCancel(); onAfterAction('cancel'); }} className="btn btn--cancel" style={buttonVariants.outline}>{cancelLabel}</button>
      </div>
      {(nameChanged || descChanged || typeChanged) && (
        <div style={{ fontSize:'0.6rem', color:'#555' }}>Modified: {[
          nameChanged && 'name',
          descChanged && 'description',
          typeChanged && 'type'
        ].filter(Boolean).join(', ')}</div>
      )}
      <div style={{ fontSize:'0.55rem', color:'#777' }}>Shortcuts: Ctrl+S / Cmd+S or Ctrl+Enter to save, Esc to cancel.</div>
    </form>
  );
});

const labelStyle = { fontSize: '0.75rem', fontWeight: 600, color: '#555' };
const inputStyle = { padding: '0.5rem', border: '1px solid #ccc', borderRadius: 6, fontSize: '0.8rem' };
const textareaStyle = { ...inputStyle, resize: 'vertical' };
const changedStyle = { boxShadow: '0 0 0 2px rgba(40,167,69,0.25)' };
