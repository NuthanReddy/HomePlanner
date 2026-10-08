import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { Obstacle, Rect, Site } from './native-api'

type Point = {x: number; y: number}
export function footprint(a: Point, b: Point): Rect {
  return {x: Math.min(a.x,b.x), y: Math.min(a.y,b.y), width: Math.abs(a.x-b.x), depth: Math.abs(a.y-b.y)}
}
type Handle = 'nw' | 'ne' | 'sw' | 'se'
export function resizeFootprint(box: Rect, handle: Handle, point: Point): Rect {
  const anchor = {x: handle.endsWith('w') ? box.x+box.width : box.x,
    y: handle.startsWith('n') ? box.y+box.depth : box.y}
  return footprint(anchor,point)
}
type Gesture = {pointerId:number; origin:Point; client:Point; before:Rect|null; mode:'move'|'draw'|Handle; moved:boolean}

export function SurroundingsCanvas({ site, envelope, busy, onAdd, onRemove }: {
  site: Site; envelope: Rect | null; busy: boolean
  onAdd: (object: Obstacle) => Promise<boolean>; onRemove: (id: string) => void
}) {
  const svg = useRef<SVGSVGElement>(null)
  const [kind, setKind] = useState<'cuboid' | 'tree'>('cuboid')
  const [start, setStart] = useState<Point | null>(null)
  const [end, setEnd] = useState<Point | null>(null)
  const [name, setName] = useState('')
  const [height, setHeight] = useState('')
  const [base, setBase] = useState('')
  const [transmission, setTransmission] = useState('')
  const [range, setRange] = useState(30)
  const [message, setMessage] = useState('')
  const [manual, setManual] = useState({x:'',y:'',width:'',depth:''})
  const [placing, setPlacing] = useState(false)
  const [editingId,setEditingId]=useState<string|null>(null)
  const [canvasPixels,setCanvasPixels]=useState(800)
  const gesture = useRef<Gesture|null>(null)
  const [hover,setHover]=useState<Point|null>(null)
  const factor = site.units === 'ft' ? .3048 : 1
  const width = (site.width ?? 0) * factor, depth = (site.depth ?? 0) * factor
  const selected = start && end ? footprint(start,end) : null
  useEffect(()=>{
    const element=svg.current
    if(!element)return
    const observer=new ResizeObserver(()=>setCanvasPixels(element.getBoundingClientRect().width||800))
    observer.observe(element)
    return ()=>observer.disconnect()
  },[width,depth])
  const obstacleKey=JSON.stringify(site.obstacles)
  useEffect(()=>{
    gesture.current=null;setStart(null);setEnd(null);setEditingId(null);setPlacing(false);setHover(null)
  },[obstacleKey])
  function preview(box:Rect) {
    setStart({x:box.x,y:box.y});setEnd({x:box.x+box.width,y:box.y+box.depth})
    setManual({x:String(box.x),y:String(box.y),width:String(box.width),depth:String(box.depth)})
  }
  function edit(o:Obstacle) {
    setEditingId(o.id);preview({x:o.x,y:o.y,width:o.width_m,depth:o.depth_m})
    setName(o.name);setKind(o.kind);setHeight(o.height_m===null?'':String(o.height_m))
    setBase(o.base_m===null?'':String(o.base_m));setTransmission(o.transmission===null?'':String(o.transmission))
    setPlacing(false);setMessage('Drag to move, drag a corner to resize, or edit numeric dimensions. Save object applies this preview.')
  }
  function point(event: PointerEvent<SVGSVGElement>): Point | null {
    const matrix = svg.current?.getScreenCTM()
    if (!matrix) return null
    const point = new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse())
    return {x: point.x,y: point.y}
  }
  function cancel() { gesture.current=null;setStart(null); setEnd(null); setHover(null);setPlacing(false); setEditingId(null); setMessage('Placement preview cancelled.') }
  function begin(event:PointerEvent<SVGSVGElement>, mode:Gesture['mode'], box:Rect|null) {
    const origin=point(event)
    if(!origin)return
    gesture.current={pointerId:event.pointerId,origin,client:{x:event.clientX,y:event.clientY},before:box,mode,moved:false}
    svg.current?.focus({preventScroll:true})
    svg.current?.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  function down(event:PointerEvent<SVGSVGElement>) {
    if(busy||event.button!==0)return
    if(placing){begin(event,'draw',selected);return}
    const target=event.target as Element
    const handle=target.getAttribute('data-handle') as Handle|null
    if(handle&&selected){begin(event,handle,selected);return}
    if(target.getAttribute('data-preview')&&selected){begin(event,'move',selected);return}
    const id=target.closest('[data-object]')?.getAttribute('data-object')
    const object=site.obstacles.find(o=>o.id===id)
    if(object){
      edit(object)
      begin(event,'move',{x:object.x,y:object.y,width:object.width_m,depth:object.depth_m})
    }
  }
  function move(event:PointerEvent<SVGSVGElement>) {
    if(busy)return
    const next=point(event)
    if(!next)return
    const drag=gesture.current
    if(!drag){if(placing&&start&&!end)setHover(next);return}
    if(drag.pointerId!==event.pointerId)return
    if(Math.hypot(event.clientX-drag.client.x,event.clientY-drag.client.y)>4)drag.moved=true
    if(!drag.moved)return
    if(drag.mode==='draw')preview(footprint(drag.origin,next))
    else if(drag.before)preview(drag.mode==='move'
      ? {...drag.before,x:drag.before.x+next.x-drag.origin.x,y:drag.before.y+next.y-drag.origin.y}
      : resizeFootprint(drag.before,drag.mode,{
        x:(drag.mode.endsWith('w')?drag.before.x:drag.before.x+drag.before.width)+next.x-drag.origin.x,
        y:(drag.mode.startsWith('n')?drag.before.y:drag.before.y+drag.before.depth)+next.y-drag.origin.y,
      }))
  }
  function finish(event:PointerEvent<SVGSVGElement>) {
    const drag=gesture.current
    if(drag&&drag.pointerId!==event.pointerId)return
    gesture.current=null
    if(svg.current?.hasPointerCapture(event.pointerId))svg.current.releasePointerCapture(event.pointerId)
    if(busy)return
    if(drag?.moved){setPlacing(false);setHover(null);setMessage('Footprint preview updated. Save the object to apply.');return}
    click(event)
  }
  function cancelGesture() {
    const drag=gesture.current
    gesture.current=null
    if(drag)setPlacing(false)
    if(drag?.before)preview(drag.before)
    else if(drag){setStart(null);setEnd(null)}
    setHover(null)
  }
  function click(event: PointerEvent<SVGSVGElement>) {
    if (busy || !placing || event.button !== 0) return
    const next = point(event)
    if (!next) { setMessage('Canvas coordinate mapping unavailable. Use numeric placement.'); return }
    if (!start || end) { setStart(next); setEnd(null) }
    else { preview(footprint(start,next)); setPlacing(false);setHover(null) }
  }
  async function add() {
    if (!selected || selected.width <= 0 || selected.depth <= 0 || !name.trim()) {
      setMessage('Draw a positive footprint and supply an object name.'); return
    }
    const optional = (value: string) => value.trim() === '' ? null : Number(value)
    const ok = await onAdd({
      id: editingId ?? crypto.randomUUID(), kind, name: name.trim(), x: selected.x,y: selected.y,
      width_m: selected.width,depth_m: selected.depth,
      height_m: optional(height),base_m: optional(base),transmission: optional(transmission),
    })
    if (ok) { setStart(null); setEnd(null); setEditingId(null); setMessage('Object saved. Undo reverses this placement.'); setName('') }
  }
  if (!width || !depth) return <p>Apply plot dimensions before drawing surroundings.</p>
  const margin = Math.max(range,...Object.values(site.roads).map(value => value ?? 0))
  const handleSize=(width+2*margin)*12/canvasPixels
  const live=selected??(start&&hover?footprint(start,hover):null)
  const outside = site.obstacles.some(o => o.x < -margin || o.y < -margin || o.x+o.width_m > width+margin || o.y+o.depth_m > depth+margin)
  return <section className="surroundings" aria-label="Draw site surroundings">
    <h2>Nearby buildings & trees</h2>
    <p>North is up. Draw by dragging or clicking two opposite corners, including beyond roads. Select a saved building or tree to move it; drag its corner handles to resize. Changes are previews until <b>Add object / Save object</b>. Escape cancels. Numeric editing is also available below.</p>
    <p>Trees are simplified canopy bounds, not species/growth or measured shading. Unknown height, base or transmission stays unknown. Objects are saved for later Python shadow/scene integration; no shade result is implied.</p>
    <div className="actions">
      <label>Object type <select aria-label="Object type" disabled={busy} value={kind} onChange={e => setKind(e.target.value as 'cuboid'|'tree')}>
        <option value="cuboid">Cuboid / building</option><option value="tree">Tree canopy</option>
      </select></label>
      <label>Surrounding extent <select aria-label="Surrounding extent" value={range} onChange={e => setRange(Number(e.target.value))}>
        {[15,30,60,120,300,1000].map(value => <option key={value} value={value}>{value} m beyond plot</option>)}
      </select></label>
      <button type="button" disabled={busy} aria-pressed={placing} onClick={() => {setPlacing(true);setStart(null);setEnd(null);setHover(null);setMessage('Drag a footprint or click the first corner, then the opposite corner.')}}>{editingId?'Redraw selected footprint':'Draw footprint'}</button>
      {editingId&&<button type="button" disabled={busy} onClick={()=>{cancel();setName('');setManual({x:'',y:'',width:'',depth:''});setPlacing(true)}}>New object</button>}
      <button type="button" onClick={cancel}>Cancel placement</button>
    </div>
    {outside && <p role="status">Some saved objects are outside this view. Increase the surrounding extent to see them; they have not been removed.</p>}
    <svg ref={svg} className="site-canvas" viewBox={`${-margin} ${-margin} ${width+2*margin} ${depth+2*margin}`}
      role="group" aria-label="Interactive north-up plot, roads and surrounding objects"
      style={{touchAction:'none'}}
      tabIndex={0} onPointerDown={down} onPointerMove={move} onPointerUp={finish}
      onPointerCancel={cancelGesture} onLostPointerCapture={cancelGesture}
      onKeyDown={e => {if(e.key==='Escape'){if(gesture.current)cancelGesture();else cancel()}}}>
      <title>Site surroundings, including objects across roads</title>
      <rect x={-margin} y={-margin} width={width+2*margin} height={depth+2*margin} fill="#f0f4f6"/>
      {site.facing.split('').map(edge => {
        const road = site.roads[edge as keyof Site['roads']]
        if (!road) return null
        const box = edge==='N'?{x:-margin,y:-road,width:width+2*margin,height:road}
          :edge==='S'?{x:-margin,y:depth,width:width+2*margin,height:road}
          :edge==='W'?{x:-road,y:-margin,width:road,height:depth+2*margin}
          :{x:width,y:-margin,width:road,height:depth+2*margin}
        return <rect key={edge} {...box} fill="#c7cdd3"><title>{edge} road: {road} m</title></rect>
      })}
      <rect x={0} y={0} width={width} height={depth} fill="#fff" stroke="#334155" strokeWidth=".2"/>
      {envelope && <rect x={envelope.x} y={envelope.y} width={envelope.width} height={envelope.depth} fill="#dbeafe" stroke="#2563eb" strokeWidth=".15"><title>Applied setback envelope, not a building</title></rect>}
      {site.obstacles.map(o => <g key={o.id} data-object={o.id} role="button" tabIndex={busy?-1:0}
        aria-label={`Edit ${o.name} on canvas`} aria-pressed={editingId===o.id} style={{cursor:'move'}}
        opacity={editingId===o.id ? .3:1}
        onKeyDown={e=>{if(!busy&&(e.key==='Enter'||e.key===' ')){e.preventDefault();edit(o)}}}>
        {o.kind==='tree'
          ? <ellipse cx={o.x+o.width_m/2} cy={o.y+o.depth_m/2} rx={o.width_m/2} ry={o.depth_m/2} fill="#86bc8b" stroke="#28633d" strokeWidth=".2"><title>{o.name}: canopy bounding footprint</title></ellipse>
          : <rect x={o.x} y={o.y} width={o.width_m} height={o.depth_m} fill="#a9a1b4" stroke="#645473" strokeWidth=".2"><title>{o.name}</title></rect>}
      </g>)}
      {start && !end && <circle cx={start.x} cy={start.y} r=".5" fill="#d97706"/>}
      {live && <g>
        {kind==='tree'&&<ellipse pointerEvents="none" cx={live.x+live.width/2} cy={live.y+live.depth/2} rx={live.width/2} ry={live.depth/2} fill="#86bc8b88" stroke="#28633d" strokeWidth=".2"/>}
        <rect data-preview="true" x={live.x} y={live.y} width={live.width} height={live.depth}
          style={{cursor:'move'}} fill={kind==='tree'?'transparent':'#fbbf2455'} stroke="#b45309" strokeWidth=".25" strokeDasharray=".8 .4"/>
        {selected&&(['nw','ne','sw','se'] as const).map(handle=><g key={handle}
          transform={`translate(${handle.endsWith('w')?selected.x:selected.x+selected.width} ${handle.startsWith('n')?selected.y:selected.y+selected.depth})`}>
          <rect data-handle={handle} x={-handleSize} y={-handleSize} width={handleSize*2} height={handleSize*2}
            fill="transparent" style={{cursor:handle==='nw'||handle==='se'?'nwse-resize':'nesw-resize'}}>
            <title>Resize {handle.toUpperCase()} corner</title>
          </rect>
          <rect pointerEvents="none" x={-handleSize/2} y={-handleSize/2} width={handleSize} height={handleSize}
            fill="white" stroke="#b45309" strokeWidth=".2"/>
        </g>)}
        <text pointerEvents="none" x={live.x} y={live.y-handleSize*2} fontSize={handleSize*2}>{live.width.toFixed(2)} × {live.depth.toFixed(2)} m</text>
      </g>}
      <text x={0} y={-2} fontSize="1.5">N ↑</text>
    </svg>
    <details open={editingId!==null||undefined}><summary>Keyboard / numeric placement and resize</summary>
      <div className="native-fields">{(['x','y','width','depth'] as const).map(key => <label key={key}>{key} (m)
        <input type="number" step="any" disabled={busy} value={manual[key]} onChange={e=>setManual({...manual,[key]:e.target.value})}/></label>)}</div>
      <button type="button" disabled={busy} onClick={()=>{
        const values = Object.values(manual)
        if(values.some(v=>v.trim()===''||!Number.isFinite(Number(v)))||Number(manual.width)<=0||Number(manual.depth)<=0) {
          setMessage('Supply finite coordinates and positive dimensions.');return
        }
        preview({x:Number(manual.x),y:Number(manual.y),width:Number(manual.width),depth:Number(manual.depth)})
        setPlacing(false)
      }}>Preview numeric footprint</button>
    </details>
    <form onSubmit={event=>{event.preventDefault();void add()}}><fieldset disabled={busy}><legend>Object properties</legend><div className="native-fields">
      <label>Object name<input value={name} maxLength={100} onChange={e=>setName(e.target.value)}/></label>
      <label>Object height (m; blank unknown)<input type="number" step="any" value={height} onChange={e=>setHeight(e.target.value)}/></label>
      <label>Absolute base elevation (m; blank unknown)<input type="number" step="any" value={base} onChange={e=>setBase(e.target.value)}/></label>
      <label>Beam transmission (0-1; blank unknown)<input type="number" min="0" max="1" step="any" value={transmission} onChange={e=>setTransmission(e.target.value)}/></label>
    </div>
    <button type="submit" disabled={busy||!selected}>{editingId?'Save object':'Add object'}</button>
    </fieldset></form>
    {message && <p role="status">{message}</p>}
    <ul>{site.obstacles.map(o=><li key={o.id}>{o.name} ({o.kind}), {o.width_m.toFixed(2)} × {o.depth_m.toFixed(2)} m; height {o.height_m ?? 'unknown'}.
      <button type="button" disabled={busy} onClick={()=>edit(o)}>Edit {o.name}</button>
      <button type="button" disabled={busy} onClick={()=>{onRemove(o.id);if(editingId===o.id)cancel()}}>Remove {o.name}</button></li>)}</ul>
  </section>
}
