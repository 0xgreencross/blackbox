/* DITHERVOID // BLACKBOX :: SCENE (AMALGAM). Stored on chain, locked before the first record.
   Inputs from the loader: window.BB (the record), window.BBF (Silkscreen TTF, base64), window.BBGO
   (resolves to the PANDORA v3 cores cut from the GLASS page). Composition in BONE; the loop in the
   scheme its seed rolls; every motion on an integer cycle of the 36-frame loop. Greencross. */
(function(){
"use strict";
var BB=window.BB||{}, N=36, RES=180, IW=240;
var BONE=['#040406','#161619','#303036','#55555e','#7a7a86','#a0a0a0','#ffffff'];
var B4=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
var MONO={stops:['#040406','#161619','#303036','#55555e','#7a7a86','#a0a0a0'],glitch:['#a0a0a0','#7a7a86','#000000','#55555e','#161619']};
var FIELD=['MOLTEN','BROADCAST','GRID','SEDIMENT','VEINED','LATHE','ENGRAVED'];
/* airports: lat, lon. Unknown codes fall back to a straight track. */
var AP={ATL:[33.64,-84.43],BOS:[42.36,-71.01],CDG:[49.01,2.55],CGK:[-6.13,106.66],CLT:[35.21,-80.94],DEN:[39.86,-104.67],DFW:[32.90,-97.04],DOH:[25.27,51.61],DPS:[-8.75,115.17],DXB:[25.25,55.36],EWR:[40.69,-74.17],FLL:[26.07,-80.15],FRA:[50.03,8.56],GRR:[42.88,-85.52],HKG:[22.31,113.91],HND:[35.55,139.78],IAD:[38.95,-77.46],IAH:[29.98,-95.34],ICN:[37.46,126.44],IST:[41.28,28.75],JFK:[40.64,-73.78],KUL:[2.75,101.71],LAS:[36.08,-115.15],LAX:[33.94,-118.41],LGA:[40.78,-73.87],LHR:[51.47,-0.45],MAD:[40.49,-3.57],MCO:[28.43,-81.31],MEX:[19.44,-99.07],MIA:[25.80,-80.29],MNL:[14.51,121.02],NRT:[35.77,140.39],ORD:[41.98,-87.90],PHX:[33.43,-112.01],SEA:[47.45,-122.31],SFO:[37.62,-122.38],SIN:[1.36,103.99],SYD:[-33.95,151.18],TPE:[25.08,121.23],YVR:[49.19,-123.18],YYZ:[43.68,-79.63],BKK:[13.69,100.75],MEL:[-37.67,144.84],AMS:[52.31,4.76],BCN:[41.30,2.08],BOG:[4.70,-74.15],GRU:[-23.43,-46.47],EZE:[-34.82,-58.54],LIM:[-12.02,-77.11],SCL:[-33.39,-70.79],SJU:[18.44,-66.00],CUN:[21.04,-86.87],SAN:[32.73,-117.19],SLC:[40.79,-111.98],MSP:[44.88,-93.22],DTW:[42.21,-83.35],PHL:[39.87,-75.24],AUS:[30.19,-97.67]};
var V={add:function(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2]];},sub:function(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];},mul:function(a,s){return [a[0]*s,a[1]*s,a[2]*s];},
  dot:function(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];},cross:function(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];},
  norm:function(a){var l=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/l,a[1]/l,a[2]/l];}};
function hslRgb(h,s,l){ h=((h%360)+360)%360/360; var q=l<.5?l*(1+s):l+s-l*s, p=2*l-q; function f(t){ t=(t+1)%1; return t<1/6?p+(q-p)*6*t:t<1/2?q:t<2/3?p+(q-p)*(2/3-t)*6:p; } return [f(h+1/3)*255|0,f(h)*255|0,f(h-1/3)*255|0]; }
function g3(lat,lon){ var a=lat*Math.PI/180,b=lon*Math.PI/180; return [Math.cos(a)*Math.cos(b),Math.cos(a)*Math.sin(b),Math.sin(a)]; }
function slerp(A,B,t){ var th=Math.acos(Math.max(-1,Math.min(1,V.dot(A,B)))), s=Math.sin(th)||1; if(th<1e-6) return A; return V.add(V.mul(A,Math.sin((1-t)*th)/s),V.mul(B,Math.sin(t*th)/s)); }
function profile(min){ var tc=Math.min(.3,22/min), td=Math.min(.35,32/min); function sm(s){return s*s*(3-2*s);} return function(t){ return t<tc?sm(t/tc):t>1-td?sm((1-t)/td):1; }; }

/* ---------- the record, as much as the chain has said ---------- */
var D=(BB.dossier||'').split('|'), sealed=!!BB.sealed, journey=BB.rec===0;
var REC={dep:D[0]||'',arr:D[1]||'',date:D[2]||'',seat:D[3]||'',min:+D[4]||+BB.minutes||(BB.cap||5)*60,km:D[5]||'',type:D[6]||''};
/* the track in the plane, departure left, arrival right, x in [-.5,.5]. Sealed records are route-free. */
function track(dep,arr,S){ var a=AP[dep], b=AP[arr], out=[], k;
  if(!a||!b){ for(k=0;k<=S;k++) out.push([k/S-.5,0]); return out; }
  var A=g3(a[0],a[1]), B=g3(b[0],b[1]), M=V.norm(V.add(A,B)), latM=Math.asin(M[2]), lonM=Math.atan2(M[1],M[0]), raw=[];
  for(k=0;k<=S;k++){ var P=slerp(A,B,k/S), lat=Math.asin(P[2]), lon=Math.atan2(P[1],P[0]), dl=lon-lonM; dl=Math.atan2(Math.sin(dl),Math.cos(dl)); raw.push([dl*Math.cos(latM),-(lat-latM)]); }
  var p0=raw[0], p1=raw[S], ang=Math.atan2(p1[1]-p0[1],p1[0]-p0[0]), ca=Math.cos(-ang), sa=Math.sin(-ang), len=Math.hypot(p1[0]-p0[0],p1[1]-p0[1])||1, mx=(p0[0]+p1[0])/2, mz=(p0[1]+p1[1])/2;
  return raw.map(function(p){ var x=p[0]-mx, z=p[1]-mz; return [(x*ca-z*sa)/len,(x*sa+z*ca)/len]; }); }

/* ---------- cameras and the loop as a material ---------- */
function persp(pos,look){ var fw=V.norm(V.sub(look,pos)), R=V.norm(V.cross(fw,[0,1,0])), U=V.cross(R,fw);
  var cam={s:1,ox:0,oy:0,P:function(p){ var d=V.sub(p,pos), z=V.dot(d,fw); return [cam.ox+cam.s*V.dot(d,R)/z, cam.oy-cam.s*V.dot(d,U)/z, -z]; }}; return cam; }
function fit(cam,pts,box){ cam.s=1;cam.ox=0;cam.oy=0; var a=1e9,b=1e9,c=-1e9,d=-1e9;
  pts.forEach(function(p){ var q=cam.P(p); a=Math.min(a,q[0]);b=Math.min(b,q[1]);c=Math.max(c,q[0]);d=Math.max(d,q[1]); });
  var s=Math.min((box[2]-box[0])/(c-a),(box[3]-box[1])/(d-b)); cam.s=s; cam.ox=(box[0]+box[2])/2-s*(a+c)/2; cam.oy=(box[1]+box[3])/2-s*(b+d)/2; }
function texTri(ctx,img,p0,p1,p2,t0,t1,t2){
  var cx=(p0[0]+p1[0]+p2[0])/3, cy=(p0[1]+p1[1]+p2[1])/3; function ex(p){ var dx=p[0]-cx,dy=p[1]-cy,l=Math.hypot(dx,dy)||1; return [p[0]+dx/l*.6,p[1]+dy/l*.6]; }
  var q0=ex(p0),q1=ex(p1),q2=ex(p2), du1=t1[0]-t0[0],dv1=t1[1]-t0[1],du2=t2[0]-t0[0],dv2=t2[1]-t0[1], det=du1*dv2-du2*dv1; if(Math.abs(det)<1e-9) return;
  var x1=p1[0]-p0[0],y1=p1[1]-p0[1],x2=p2[0]-p0[0],y2=p2[1]-p0[1], a=(x1*dv2-x2*dv1)/det, b=(y1*dv2-y2*dv1)/det, c=(x2*du1-x1*du2)/det, d=(y2*du1-y1*du2)/det;
  ctx.save(); ctx.beginPath(); ctx.moveTo(q0[0],q0[1]); ctx.lineTo(q1[0],q1[1]); ctx.lineTo(q2[0],q2[1]); ctx.closePath(); ctx.clip();
  ctx.setTransform(a,b,c,d,p0[0]-a*t0[0]-c*t0[1],p0[1]-b*t0[0]-d*t0[1]); ctx.drawImage(img,0,0); ctx.restore(); }
function poly(ctx,pts,col){ ctx.beginPath(); pts.forEach(function(p,i){ i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]); }); ctx.closePath(); ctx.fillStyle=col; ctx.fill(); }
function texQuad(ctx,img,q,uv,lum){ poly(ctx,q,'#000'); ctx.globalAlpha=Math.max(0,Math.min(1,lum)); texTri(ctx,img,q[0],q[1],q[2],uv[0],uv[1],uv[2]); texTri(ctx,img,q[0],q[2],q[3],uv[0],uv[2],uv[3]); ctx.globalAlpha=1; }
function wrapU(u){ return ((u%RES)+RES)%RES; }

/* ---------- the scene: one curtain per record, standing on its own dithered reflection ---------- */
function build(){
  var legs=[];
  if(journey){ (BB.records||[]).forEach(function(r){ var d=(r.dossier||'').split('|'); legs.push({dep:d[0],arr:d[1],min:+d[4]||300}); }); if(!legs.length) legs.push({dep:'',arr:'',min:300}); }
  else legs.push(sealed?{dep:'',arr:'',min:REC.min}:{dep:REC.dep,arr:REC.arr,min:REC.min});
  var total=legs.reduce(function(s,l){return s+l.min;},0), S=80, H=1.0, base=[], alt=[], tt=[], x0=-1.2, span=2.4, k, off=0;
  legs.forEach(function(l,li){ var n=Math.max(8,Math.round(S*l.min/total)), tr=track(l.dep,l.arr,n), pf=profile(l.min), w=span*l.min/total;
    for(k=(li?1:0);k<=n;k++){ var t=k/n; base.push([x0+off+(tr[k][0]+.5)*w, 0, tr[k][1]*w]); alt.push(pf(t)); tt.push((off+t*w)/span); }
    l.i0=base.length-1-n+(li?1:0)-(li?0:0); l.i1=base.length-1; off+=w; });
  var seedAng=((BB.seed>>>0)%1000/1000-.5)*.8, Dd=3.4, cam=persp([Math.sin(-.42+seedAng)*Dd,.42,Math.cos(-.42+seedAng)*Dd],[0,.15,0]);
  var ext=[]; base.forEach(function(p,i){ ext.push(p,[p[0],H*alt[i],p[2]],[p[0],-H*.85*alt[i],p[2]]); }); fit(cam,ext,[34,20,IW-34,IW-44]);
  return {legs:legs,base:base,alt:alt,tt:tt,cam:cam,H:H}; }

/* marks never sit on the loop or its reflection: they take the first clear spot, walking outward */
function maskData(polys){ var c=document.createElement('canvas'); c.width=c.height=IW; var x=c.getContext('2d'); x.fillStyle='#fff';
  polys.forEach(function(q){ x.beginPath(); q.forEach(function(p,i){ i?x.lineTo(p[0],p[1]):x.moveTo(p[0],p[1]); }); x.closePath(); x.fill(); }); return x.getImageData(0,0,IW,IW).data; }
function clearAt(m,x0,y0,x1,y1,pad){ x0=Math.floor(x0-pad); y0=Math.floor(y0-pad); x1=Math.ceil(x1+pad); y1=Math.ceil(y1+pad);
  if(x0<3||y0<3||x1>IW-3||y1>IW-30) return false; for(var y=y0;y<y1;y++) for(var x=x0;x<x1;x++) if(m[(y*IW+x)*4+3]) return false; return true; }
function placeMarks(m,ends,measure){ var taken=[], dots=[], labs=[];
  function hit(a,b){ return !(a[2]<=b[0]||b[2]<=a[0]||a[3]<=b[1]||b[3]<=a[1]); }
  ends.forEach(function(e){ var dp=null, d;
    for(d=0;d<=40;d++){ var x=e.p[0]+e.out[0]*d, y=e.p[1]+e.out[1]*d; if(clearAt(m,x-1,y-1,x+2,y+2,1)){ dp=[x,y]; break; } }
    if(!dp) return; if(e.dot) dots.push(dp); taken.push([dp[0]-2,dp[1]-2,dp[0]+3,dp[1]+3]); if(!e.text) return;
    var w=measure(e.text), h=8, r, a;
    for(r=6;r<=70;r+=3) for(a=0;a<16;a++){ var t=a/16*Math.PI*2, bx=[dp[0]+Math.cos(t)*r-w/2,dp[1]+Math.sin(t)*r-h/2]; var box=[bx[0],bx[1],bx[0]+w,bx[1]+h];
      if(!clearAt(m,box[0],box[1],box[2],box[3],2)) continue; if(taken.some(function(tk){ return hit(tk,[box[0]-2,box[1]-2,box[2]+2,box[3]+2]); })) continue;
      taken.push(box); labs.push([box[0],box[1],e.text]); return; } });
  return {dots:dots,labs:labs}; }

/* ---------- run ---------- */
window.BBGO.then(function(E){
  /* the engine's own helpers on the main thread, for the job roll (palette, mode, rng) */
  var s=document.createElement('script');
  s.text='var W=180,H=180,FW=360,PVSW=180,PVVG=56,OUTD=0,TAU=6.283185307179586;\n'+E.V3_CORE+'\n'+E.V3_CORE2+'\nwindow.__BBX={mulberry32:mulberry32,MODES:MODES,SCHEMES:SCHEMES,SCHEME_KEYS:SCHEME_KEYS,genesisScheme:genesisScheme,tisScheme:tisScheme};';
  document.head.appendChild(s); var X=window.__BBX, CARD_CH=E.CARD_CH;
  function job(seed,isSealed){ var rng=X.mulberry32((seed^0xC41E)>>>0), mode=X.MODES[(rng()*X.MODES.length)|0], si=(rng()*(X.SCHEME_KEYS.length+2))|0;
    var scheme= si<X.SCHEME_KEYS.length?X.SCHEMES[X.SCHEME_KEYS[si]]:(si===X.SCHEME_KEYS.length?X.genesisScheme(seed):X.tisScheme(seed));
    var corr=20+((rng()*75)|0), FAV={embers:1,bloom:1,panes:1,melt:1,ghost:1,invert:1,lungs:1,runes:1,meta:1,entropy:1,chimera:1,hilb:1,tunnel:1,chrono:1}, PILL={chroma:1,tracking:1,pixelsort:1,grain:1,blocks:1,scanlines:1,echo:1}, fx={};
    CARD_CH.forEach(function(k){ fx[k]=PILL[k]?rng()<.55:FAV[k]?rng()<.30:rng()<.10; }); fx.kaleido=false; fx.invert=false; fx.chimera=false;
    var voidamt=(rng()*60)|0, locality=(rng()*100)|0, chromacap=rng()<.15?1:0;
    if(FIELD.indexOf(mode)<0) mode=FIELD[seed%FIELD.length]; voidamt=Math.min(voidamt,25);
    if(isSealed){ scheme=MONO; corr=100; voidamt=40; CARD_CH.forEach(function(k){ fx[k]=false; }); fx.tracking=fx.scanlines=fx.dropout=fx.grain=true; }
    return {seed:seed,mode:mode,voidamt:voidamt,locality:locality,chromacap:chromacap,scheme:{stops:scheme.stops,glitch:scheme.glitch},corr:corr,N:N,fx:fx,
      ov:{maskType:0,maskStyle:0,cx:16,cy:16,size:16,n:0,form:0},epoch:0,ver:6,wb:{fam:null,prim:null,cam:null,mod:null,gain:{}},gr:null}; }
  var src='"use strict";const W='+RES+',H='+RES+',FW=360,PVSW='+Math.max(160,Math.min(448,RES))+',PVVG='+Math.max(56,Math.min(88,Math.round(88*Math.min(1,RES/448))))+',OUTD=0;const TAU=6.283185307179586;\n'+E.V3_CORE+'\n'+E.V3_CORE2+'\n'+E.V3_DRIVER;
  var wk=new Worker(URL.createObjectURL(new Blob([src],{type:'text/javascript'}))), J=job(BB.seed>>>0,sealed), frames=new Array(N), got=0, pal=null;

  /* display: integer upscale of the 240 raster, centred */
  var cv=document.createElement('canvas'), dx=cv.getContext('2d'); document.body.appendChild(cv);
  var off=document.createElement('canvas'); off.width=off.height=IW; var ox=off.getContext('2d');
  var refl=document.createElement('canvas'); refl.width=refl.height=IW; var rx=refl.getContext('2d');
  var veil=document.createElement('canvas'); veil.width=veil.height=IW; (function(){ var v=veil.getContext('2d'), im=v.createImageData(IW,IW); for(var y=0;y<IW;y++) for(var x=0;x<IW;x++) im.data[(y*IW+x)*4+3]=B4[(y&3)*4+(x&3)]<7?255:0; v.putImageData(im,0,0); })();
  var K=1, DW=IW;
  function size(){ var S=Math.min(innerWidth,innerHeight)||IW*2; K=Math.max(1,Math.floor(S/IW)); DW=IW*K; cv.width=cv.height=DW;
    cv.style.cssText='position:absolute;left:50%;top:50%;width:'+DW+'px;height:'+DW+'px;margin:-'+DW/2+'px 0 0 -'+DW/2+'px;image-rendering:pixelated;background:#000';
    dx.imageSmoothingEnabled=false; markKey=''; }
  var G=build(), marks=null, markKey='';
  /* the scene is periodic over 288 frames (8 loops): each frame is composed once, then replayed */
  var cache=[], cacheK=-1;
  addEventListener('resize',size); size();
  function silk(t,x,y,px,col,al){ dx.font=px+"px Silkscreen, monospace"; dx.fillStyle=col; dx.textBaseline='top'; dx.textAlign=al||'left'; dx.fillText(t,x,y); }
  function measure(t){ ox.font="8px Silkscreen, monospace"; return Math.ceil(ox.measureText(t).width); }

  function frame(T,g,warm){
    var travel=(g%(N*4))/(N*4), hue=g/(N*8)*360, shift=travel*RES, now=(BB.now||0)+(Date.now()-T0)/1000;
    var prog=sealed&&!journey&&BB.deadline>BB.open?Math.max(.02,Math.min(1,(now-BB.open)/(BB.deadline-BB.open))):1;
    var cam=G.cam, base=G.base, alt=G.alt, tt=G.tt, H=G.H, n=base.length-1, kmax=Math.ceil(prog*n), polys=[];
    if(kmax!==cacheK){ cache=[]; cacheK=kmax; }
    if(cache[g]){ if(!warm){ dx.drawImage(cache[g],0,0,DW,DW); overlay(); } return; }
    ox.setTransform(1,0,0,1,0,0); ox.fillStyle='#000'; ox.fillRect(0,0,IW,IW);
    function quads(c,mir){ const items=[];
      const kend=(sealed&&!journey)?n:kmax;
      for(let k=0;k<kend&&k<n;k++){ const ghost=k>=kmax; const u0=wrapU(tt[k]*RES-shift), u1=u0+(tt[k+1]-tt[k])*RES, a0=alt[k], a1=alt[k+1], sg=mir?-.85:1;
        const tan=V.norm(V.sub(base[k+1],base[k])), nrm=V.norm(V.cross(tan,[0,1,0])), lum=.5+.5*Math.abs(V.dot(nrm,V.norm([.55,0,.35])));
        for(let b=0;b<6;b++){ (function(f0,f1){
          function P(i,a,f){ return [base[i][0],sg*H*a*f,base[i][2]]; }
          var q=[P(k,a0,f0),P(k+1,a1,f0),P(k+1,a1,f1),P(k,a0,f1)].map(cam.P), z=(q[0][2]+q[2][2])/2, fade=Math.pow(f1,.7); polys.push(q);
          items.push([z,function(){ texQuad(c,T,q,[[u0,RES*(1-f0*a0)],[u1,RES*(1-f0*a1)],[u1,RES*(1-f1*a1)],[u0,RES*(1-f1*a0)]],(mir?.40:lum)*fade*(ghost?.12:1)); }]); })(b/6,(b+1)/6); } }
      items.sort(function(a,b){return a[0]-b[0];}).forEach(function(it){ it[1](); }); }
    rx.setTransform(1,0,0,1,0,0); rx.clearRect(0,0,IW,IW); quads(rx,true); rx.globalCompositeOperation='destination-out'; rx.drawImage(veil,0,0); rx.globalCompositeOperation='source-over'; ox.drawImage(refl,0,0);
    /* the floor: a graticule whose dim hue drifts one turn every eight loops */
    for(var i=-8;i<=8;i++){ var zz=i*.3, a=cam.P([-2.4,0,zz]), b=cam.P([2.4,0,zz]), c=cam.P([zz,0,-2.4]), d=cam.P([zz,0,2.4]);
      ox.strokeStyle='rgb('+hslRgb((i+8)/16*300+hue,.7,.10)+')'; ox.lineWidth=1; ox.beginPath(); ox.moveTo(a[0],a[1]); ox.lineTo(b[0],b[1]); ox.stroke();
      ox.strokeStyle='rgb('+hslRgb((i+8)/16*300+60+hue,.7,.10)+')'; ox.beginPath(); ox.moveTo(c[0],c[1]); ox.lineTo(d[0],d[1]); ox.stroke(); }
    quads(ox,false);
    var key=kmax+'|'+K; if(key!==markKey){ markKey=key; var m=maskData(polys), ends=[];
      G.legs.forEach(function(l,li){ var i0=li?G.legs[li-1].i1:0, pa=cam.P(base[i0]), pb=cam.P(base[l.i1]), mid=cam.P(base[Math.round((i0+l.i1)/2)]);
        function out(p){ var dx_=p[0]-mid[0], dy_=p[1]-mid[1], ll=Math.hypot(dx_,dy_)||1; return [dx_/ll,dy_/ll]; }
        if(li===0) ends.push({p:pa,out:out(pa),text:sealed?'':l.dep,dot:true});
        if(!sealed) ends.push({p:pb,out:out(pb),text:l.arr,dot:true}); });
      if(sealed&&prog<1){ var pp=cam.P(base[Math.min(n,kmax)]); ends.push({p:pp,out:[0,1],text:'',dot:true}); }
      marks=placeMarks(m,ends,measure); }
    ox.fillStyle='#fff'; marks.dots.forEach(function(d){ ox.fillRect(Math.round(d[0])-1,Math.round(d[1])-1,3,3); });
    var cc=document.createElement('canvas'); cc.width=cc.height=IW; cc.getContext('2d').drawImage(off,0,0); cache[g]=cc;
    if(!warm){ dx.drawImage(off,0,0,DW,DW); overlay(); } }
  /* labels and legend are drawn at display resolution over the cached raster */
  function overlay(){
    marks.labs.forEach(function(l){ silk(l[2],l[0]*K,l[1]*K,8*K,'#fff'); });
    /* the legend: label and hash while sealed; the record once landed */
    var lx=8*K, ly=DW-25*K, u=4*K, hh=(BB.passHash||'').toUpperCase();
    if(journey){ silk('DITHERVOID // BLACKBOX  THE COMPLETE JOURNEY',lx,ly,u,'#fff'); silk(G.legs.map(function(l){return l.dep;}).concat([G.legs[G.legs.length-1].arr]).join(' > '),lx,ly+7*K,u,BONE[4]); }
    else if(sealed){ silk('DITHERVOID // BLACKBOX  '+(BB.label||'')+'  SEALED',lx,ly,u,'#fff'); silk(hh.slice(0,34),lx,ly+7*K,u,BONE[4]); silk(hh.slice(34),lx+8*K,ly+14*K,u,BONE[4]); }
    else { silk((BB.label||'')+'  '+REC.dep+' > '+REC.arr+'  '+String(BB.index).padStart(2,'0')+'/'+String(BB.minted).padStart(2,'0'),lx,ly,u,'#fff');
      silk(REC.min+' MIN  '+REC.date+'  SEAT '+REC.seat,lx,ly+7*K,u,BONE[4]); silk((REC.km?REC.km+' KM  ':'')+REC.type,lx,ly+14*K,u,BONE[4]); } }

  var T0=Date.now(), tiles=null;
  wk.onmessage=function(e){ var m=e.data; if(m.t==='meta'){ pal=m.pal; return; } if(m.t!=='pv') return;
    if(!frames[m.i]){ frames[m.i]=new Uint8Array(m.buf); got++; }
    if(got<N){ var nx=0; while(frames[nx]) nx++; wk.postMessage({t:'job',job:Object.assign({},J,{__i:nx}),step:true}); return; }
    wk.terminate(); tiles=frames.map(function(buf){ var c=document.createElement('canvas'); c.width=RES*2; c.height=RES; var x=c.getContext('2d'), im=x.createImageData(RES,RES), d=im.data;
      for(var i=0,p=0;i<RES*RES;i++,p+=4){ var k=pal[buf[i]]||pal[0]; d[p]=k[0];d[p+1]=k[1];d[p+2]=k[2];d[p+3]=255; } x.putImageData(im,0,0); x.putImageData(im,RES,0); return c; });
    warm(0); };
  function warm(i){ var t1=performance.now(); if(i===0){ frame(tiles[0],0); i=1; } while(i<N*8&&performance.now()-t1<24){ frame(tiles[i%N],i,true); i++; }
    if(i<N*8){ setTimeout(function(){ warm(i); },0); return; } T0=Date.now(); requestAnimationFrame(tick); }
  wk.postMessage({t:'job',job:Object.assign({},J,{__i:0}),step:true});
  var lastG=-1; function tick(){ requestAnimationFrame(tick); var g=Math.floor((Date.now()-T0)/40)%(N*8); if(g===lastG) return; lastG=g; frame(tiles[g%N],g); }
  try{ var ff=new FontFace('Silkscreen','url(data:font/ttf;base64,'+String(window.BBF||'').trim()+')'); ff.load().then(function(f){ document.fonts.add(f); markKey=''; cache=[]; }); }catch(e){}
});
})();
