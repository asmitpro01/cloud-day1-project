"""Procedural documentary underscore (royalty-free, generated locally). Usage: python music.py out.wav [seconds]"""
import sys, wave, numpy as np
SR=48000; DUR=float(sys.argv[2]) if len(sys.argv)>2 else 30.5
N=int(SR*DUR); t=np.arange(N)/SR; rng=np.random.default_rng(3)
def hz(m): return 440*2**((m-69)/12)
def env(a,b,att,rel):  # smooth window from a to b seconds
    e=np.zeros(N); i0,i1=int(a*SR),min(N,int(b*SR)); x=t[i0:i1]-a; L=b-a
    e[i0:i1]=np.clip(x/att,0,1)*np.clip((L-x)/rel,0,1); return e**1.5
def pad(m,a,b,amp):
    out=np.zeros(N)
    for det in (-0.07,0.0,0.06):
        f=hz(m+det); ph=rng.uniform(0,6.28)
        for n in range(1,9): out+=np.sin(2*np.pi*f*n*t+ph*n)*(1/n)**1.6*(0.6 if n>1 else 1)
    return out*env(a,b,2.2,2.6)*amp/3
L=np.zeros(N); R=np.zeros(N)
chords=[(0,8.2,[50,57,62,65,69]),(7.4,15.6,[46,53,58,62,65]),(14.8,23.0,[41,53,57,60,65]),(22.2,27.0,[48,55,60,64,67]),(26.2,DUR,[41,53,57,60,64,69])]
for a,b,notes in chords:
    for k,m in enumerate(notes):
        s=pad(m,a,b,0.055 if m>52 else 0.07); pan=0.5+0.35*np.sin(k*1.7)
        L+=s*(1-pan); R+=s*pan
# low drone
dr=(np.sin(2*np.pi*hz(38)*t)+.35*np.sin(2*np.pi*hz(50)*t))*env(0,DUR,3,3)*0.09
L+=dr; R+=dr
# soft "bansuri" motif: sine + vibrato + breath
def flute(notes,start,step,amp):
    global L,R
    for i,(m,d) in enumerate(notes):
        a=start+i*step; b=a+d; f=hz(m); vib=1+0.006*np.sin(2*np.pi*5.2*t)*np.clip((t-a-0.25)*3,0,1)
        ph=2*np.pi*np.cumsum(f*vib)/SR; e=env(a,b,0.18,0.5)
        s=(np.sin(ph)+0.18*np.sin(2*ph)+0.05*np.sin(3*ph))*e*amp
        br=np.convolve(rng.normal(0,1,N),np.ones(24)/24,"same")*e*amp*0.08  # soft, low-passed breath
        L+=s*.55+br; R+=s*.45+br
flute([(74,1.2),(72,0.6),(69,1.8)],2.0,0.75,0.05)
flute([(69,0.8),(72,0.8),(74,1.6)],15.2,0.7,0.045)
flute([(76,0.9),(74,0.7),(72,0.7),(69,2.6)],26.4,0.65,0.05)
# low taiko-like pulse, building from 12 s, resolving by 28 s
bpm=76; beat=60/bpm; x=12.0
while x<27.8:
    i0=int(x*SR); n=int(0.9*SR); tt=np.arange(min(n,N-i0))/SR
    f=72*np.exp(-tt*5)+46; hit=np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-tt*6.5)
    g=0.05+0.12*min(1,(x-12)/13)
    L[i0:i0+len(tt)]+=hit*g; R[i0:i0+len(tt)]+=hit*g; x+=beat*(2 if x<20 else 1)
# reverb (FFT convolution with decaying noise)
def verb(sig,sec=2.8,mix=.32,seed=0):
    r=np.random.default_rng(seed); n=int(sec*SR); ir=r.normal(0,1,n)*np.exp(-np.arange(n)/SR*3.2); ir/=np.sqrt((ir**2).sum())
    m=1<<int(np.ceil(np.log2(len(sig)+n))); w=np.fft.irfft(np.fft.rfft(sig,m)*np.fft.rfft(ir,m),m)[:len(sig)]
    return sig*(1-mix)+w*mix*1.6
L=verb(L,seed=1); R=verb(R,seed=2)
fo=np.clip((DUR-t)/1.6,0,1); fi=np.clip(t/0.6,0,1); L*=fo*fi; R*=fo*fi
pk=max(abs(L).max(),abs(R).max()); L/=pk*1.12; R/=pk*1.12
st=np.stack([L,R],1); w=wave.open(sys.argv[1],"wb"); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
w.writeframes((st*32767).astype("<i2").tobytes()); w.close(); print("music ok", DUR)
