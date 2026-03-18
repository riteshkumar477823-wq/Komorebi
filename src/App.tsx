import React, { useState, useEffect, createContext, useContext } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  User, 
  signOut 
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  collection, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  addDoc,
  Timestamp,
  getDocFromServer
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserProfile, Vocabulary, OperationType, FirestoreErrorInfo } from './types';
import { 
  Flame, 
  BookOpen, 
  PlusCircle, 
  Search, 
  Brain, 
  LogOut, 
  ChevronRight, 
  CheckCircle2, 
  XCircle,
  AlertCircle,
  Trophy,
  Volume2,
  Languages,
  List,
  Pencil,
  Trash2,
  Eraser,
  RotateCcw
} from 'lucide-react';
import { GoogleGenAI, Modality } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import { format, isToday, startOfDay, differenceInDays } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { hiragana, katakana } from './kanaData';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Hooks ---
const useTTS = () => {
  const [loading, setLoading] = useState(false);

  const play = async (text: string) => {
    if (loading || !text) return;
    setLoading(true);
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.error("Gemini API Key is missing");
        return;
      }

      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Say clearly in Japanese: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioContextClass();
        
        // Ensure audio context is resumed (browser requirement)
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }

        const audioData = atob(base64Audio);
        const arrayBuffer = new ArrayBuffer(audioData.length);
        const view = new Uint8Array(arrayBuffer);
        for (let i = 0; i < audioData.length; i++) {
          view[i] = audioData.charCodeAt(i);
        }

        // The model returns raw PCM 16-bit mono at 24kHz
        const int16Data = new Int16Array(arrayBuffer);
        const float32Data = new Float32Array(int16Data.length);
        for (let i = 0; i < int16Data.length; i++) {
          float32Data[i] = int16Data[i] / 32768.0;
        }

        const audioBuffer = audioContext.createBuffer(1, float32Data.length, 24000);
        audioBuffer.getChannelData(0).set(float32Data);

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);
        
        source.onended = () => {
          audioContext.close();
        };

        source.start();
      }
    } catch (error) {
      console.error("TTS Error:", error);
    } finally {
      setLoading(false);
    }
  };

  return { play, loading };
};

// --- Contexts ---
const AuthContext = createContext<{
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
  setDemoMode: (val: boolean) => void;
  isDemo: boolean;
}>({
  user: null,
  profile: null,
  loading: true,
  signIn: async () => {},
  logout: async () => {},
  setDemoMode: () => {},
  isDemo: false,
});

// --- Error Handling ---
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Components ---

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (event.error?.message?.includes('{"error":')) {
        setHasError(true);
        setErrorDetails(event.error.message);
      }
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 p-4">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-xl border border-red-100">
          <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
          <h2 className="text-2xl font-bold text-stone-900 mb-2">Something went wrong</h2>
          <p className="text-stone-600 mb-6 font-serif italic">
            There was an issue connecting to our Japanese learning database.
          </p>
          <div className="bg-red-50 p-4 rounded-xl mb-6 overflow-auto max-h-40">
            <code className="text-xs text-red-700">{errorDetails}</code>
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="w-full py-3 bg-stone-900 text-white rounded-full font-medium hover:bg-stone-800 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

const Login = () => {
  const { setDemoMode } = useContext(AuthContext);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f2ed] p-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full text-center"
      >
        <div className="mb-8 inline-flex items-center justify-center w-20 h-20 bg-stone-900 rounded-3xl rotate-3 shadow-lg">
          <span className="text-4xl text-white font-bold">木</span>
        </div>
        <h1 className="text-5xl font-serif font-light text-stone-900 mb-4 tracking-tight">Komorebi</h1>
        <p className="text-stone-600 mb-12 font-serif italic text-lg">
          "Sunlight filtering through the leaves." <br/>
          Your daily companion for mastering Japanese.
        </p>

        <div className="space-y-4">
          <button 
            onClick={() => setDemoMode(true)}
            className="w-full py-5 bg-stone-900 text-white rounded-full font-bold hover:bg-stone-800 transition-all shadow-xl shadow-stone-200 text-lg"
          >
            Start Learning Now
          </button>
        </div>

        <p className="mt-8 text-stone-400 text-xs font-serif italic">
          No login required. Your progress is saved locally.
        </p>
      </motion.div>
    </div>
  );
};

const Dashboard = ({ vocabCount, vocab }: { vocabCount: number, vocab: Vocabulary[] }) => {
  const { profile } = useContext(AuthContext);
  const streak = profile?.streakCount || 0;
  const goalMet = profile?.dailyGoalMet || false;
  const { play, loading: ttsLoading } = useTTS();

  const wordOfTheDay = vocab.length > 0 ? vocab[Math.floor(Math.random() * vocab.length)] : null;

  return (
    <div className="space-y-12">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-4xl font-editorial italic text-stone-900 mb-1">
            Okaeri, <span className="font-medium">{profile?.displayName?.split(' ')[0]}</span>
          </h2>
          <p className="text-stone-500 font-serif italic">The path to mastery is paved with daily steps.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 px-6 py-3 bg-white text-orange-600 rounded-full border border-stone-100 shadow-sm">
            <Flame className="w-5 h-5 fill-orange-500" />
            <span className="font-bold text-lg">{streak}</span>
          </div>
          <div className="flex items-center gap-3 px-6 py-3 bg-stone-900 text-white rounded-full shadow-xl shadow-stone-200">
            <Trophy className="w-5 h-5 fill-emerald-400 text-emerald-400" />
            <span className="font-bold text-lg">{profile?.xp || 0}</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <motion.div 
          whileHover={{ y: -4 }}
          className="lg:col-span-2 p-10 bg-white rounded-[3rem] shadow-sm border border-stone-50 flex flex-col justify-between min-h-[300px] relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
            <span className="text-[12rem] font-serif leading-none">夢</span>
          </div>
          
          <div>
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-400 mb-6">Daily Progress</h3>
            <p className="text-3xl font-editorial italic text-stone-800 leading-tight">
              {goalMet 
                ? "You've reached today's summit. Rest well, or keep climbing." 
                : "Five new words today. Each one is a seed for your future."}
            </p>
          </div>
          
          <div className="mt-12">
            <div className="h-4 w-full bg-stone-50 rounded-full overflow-hidden border border-stone-100">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${Math.min((vocabCount / 5) * 100, 100)}%` }}
                className="h-full bg-stone-900"
              />
            </div>
            <div className="mt-4 flex justify-between items-end">
              <p className="text-sm font-bold text-stone-900 uppercase tracking-widest">{vocabCount} / 5 words</p>
              {goalMet && <span className="text-xs font-bold text-emerald-600 uppercase tracking-widest">Goal Met</span>}
            </div>
          </div>
        </motion.div>

        <motion.div 
          whileHover={{ y: -4 }}
          className="p-10 bg-[#fdfbf7] border border-stone-100 rounded-[3rem] shadow-sm flex flex-col justify-between min-h-[300px]"
        >
          <div>
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-stone-400 mb-6">Word of the Day</h3>
            {wordOfTheDay ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-5xl font-serif text-stone-900">{wordOfTheDay.japanese}</span>
                  <button 
                    onClick={() => play(wordOfTheDay.japanese)}
                    disabled={ttsLoading}
                    className="p-3 bg-white rounded-full shadow-sm border border-stone-100 hover:bg-stone-50 transition-all"
                  >
                    <Volume2 className={cn("w-5 h-5 text-stone-600", ttsLoading && "animate-pulse")} />
                  </button>
                </div>
                <div>
                  <p className="text-stone-400 font-mono text-xs uppercase tracking-widest mb-1">{wordOfTheDay.romaji}</p>
                  <p className="text-xl font-editorial italic text-stone-700">{wordOfTheDay.meaning}</p>
                </div>
              </div>
            ) : (
              <p className="text-stone-400 font-editorial italic">Add words to see a daily highlight.</p>
            )}
          </div>
          
          <div className="mt-8 pt-8 border-t border-stone-100 flex items-center gap-3 text-stone-400 text-xs font-bold uppercase tracking-widest">
            <Brain className="w-4 h-4" />
            <span>Reflect on this word</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

const VocabList = ({ vocab }: { vocab: Vocabulary[] }) => {
  const [search, setSearch] = useState('');
  const { play, loading: ttsLoading } = useTTS();

  const filteredVocab = vocab.filter(v => 
    v.japanese.includes(search) || 
    v.meaning.toLowerCase().includes(search.toLowerCase()) || 
    (v.romaji && v.romaji.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-10">
        <h2 className="text-4xl font-editorial italic text-stone-900 mb-2">Vocabulary Library</h2>
        <p className="text-stone-500 font-serif italic">Your personal collection of words and phrases.</p>
      </div>

      <div className="relative mb-8">
        <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-stone-400 w-5 h-5" />
        <input 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by Kanji, Kana, Romaji or Meaning..."
          className="w-full p-6 pl-16 bg-white border border-stone-100 rounded-[2rem] shadow-sm focus:border-stone-900 transition-all text-lg outline-none"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredVocab.length === 0 ? (
          <div className="col-span-full text-center py-20 bg-white rounded-[3rem] border border-stone-50">
            <p className="text-stone-400 font-editorial italic">No words found matching your search.</p>
          </div>
        ) : (
          filteredVocab.map((v) => (
            <motion.div 
              key={v.id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="group bg-white p-6 rounded-3xl border border-stone-50 shadow-sm hover:shadow-md transition-all flex items-center justify-between"
            >
              <div className="flex items-center gap-6">
                <div className="w-14 h-14 bg-stone-50 rounded-2xl flex items-center justify-center text-2xl font-serif text-stone-900 group-hover:bg-stone-900 group-hover:text-white transition-colors">
                  {v.japanese[0]}
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-serif text-stone-900">{v.japanese}</span>
                    <span className="text-stone-400 font-mono text-[10px] uppercase tracking-widest">{v.romaji}</span>
                  </div>
                  <p className="text-stone-500 font-editorial italic">{v.meaning}</p>
                </div>
              </div>
              <button 
                onClick={() => play(v.japanese)}
                disabled={ttsLoading}
                className="p-3 text-stone-300 hover:text-stone-900 hover:bg-stone-50 rounded-full transition-all"
              >
                <Volume2 className={cn("w-5 h-5", ttsLoading && "animate-pulse")} />
              </button>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
};

const Translator = () => {
  const [text, setText] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const { play, loading: ttsLoading } = useTTS();

  const handleTranslate = async () => {
    if (!text) return;
    setLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Translate the following text between English and Japanese. Provide the translation, romaji (if Japanese), and a brief explanation of any cultural nuances or grammar points. Text: "${text}"`,
      });
      setResult(response.text || "No translation found.");
    } catch (error) {
      console.error("Translation Error:", error);
      setResult("Sorry, I couldn't translate that. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-10">
        <h2 className="text-4xl font-editorial italic text-stone-900 mb-2">Sentence Translator</h2>
        <p className="text-stone-500 font-serif italic">AI-powered translation with cultural context.</p>
      </div>

      <div className="space-y-6">
        <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-stone-50">
          <textarea 
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a sentence in English or Japanese..."
            className="w-full h-32 p-4 bg-stone-50 border-none rounded-2xl focus:ring-2 focus:ring-stone-100 transition-all text-lg resize-none outline-none"
          />
          <div className="mt-6 flex justify-end">
            <button 
              onClick={handleTranslate}
              disabled={loading || !text}
              className="px-10 py-4 bg-stone-900 text-white rounded-full font-bold hover:bg-stone-800 transition-all shadow-xl shadow-stone-100 disabled:opacity-50"
            >
              {loading ? "Translating..." : "Translate"}
            </button>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {result && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white p-10 rounded-[3rem] shadow-sm border border-stone-50 relative"
            >
              <div className="absolute top-8 right-8">
                <button 
                  onClick={() => {
                    // Try to find the Japanese text in the result
                    // Usually it's the first line or in a block
                    const lines = result.split('\n').filter(l => l.trim().length > 0);
                    const japaneseLine = lines.find(l => /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(l));
                    play(japaneseLine || lines[0]);
                  }}
                  disabled={ttsLoading}
                  className="p-3 bg-stone-50 rounded-full text-stone-400 hover:text-stone-900 transition-all"
                >
                  <Volume2 className={cn("w-5 h-5", ttsLoading && "animate-pulse")} />
                </button>
              </div>
              <div className="prose prose-stone max-w-none">
                <ReactMarkdown>{result}</ReactMarkdown>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

const DrawingCanvas = ({ target }: { target: string }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.strokeStyle = '#1c1917';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    draw(e);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    let x, y;

    if ('touches' in e) {
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }

    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <div className="space-y-4">
      <div className="relative bg-white rounded-[2rem] border-2 border-stone-100 shadow-inner overflow-hidden aspect-square max-w-sm mx-auto">
        <div className="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none">
          <span className="text-[15rem] font-serif">{target}</span>
        </div>
        <canvas 
          ref={canvasRef}
          width={400}
          height={400}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseOut={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className="w-full h-full cursor-crosshair touch-none"
        />
      </div>
      <div className="flex justify-center gap-4">
        <button 
          onClick={clearCanvas}
          className="flex items-center gap-2 px-6 py-3 bg-stone-100 text-stone-600 rounded-full font-bold hover:bg-stone-200 transition-all"
        >
          <Eraser className="w-4 h-4" />
          Clear
        </button>
      </div>
    </div>
  );
};

const KanaPractice = () => {
  const [type, setType] = useState<'hiragana' | 'katakana'>('hiragana');
  const [selected, setSelected] = useState(hiragana[0]);
  const { play, loading: ttsLoading } = useTTS();

  const data = type === 'hiragana' ? hiragana : katakana;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-4xl font-editorial italic text-stone-900 mb-2">Kana Practice</h2>
          <p className="text-stone-500 font-serif italic">Master the building blocks of Japanese.</p>
        </div>
        <div className="flex bg-white p-1 rounded-full border border-stone-100 shadow-sm">
          <button 
            onClick={() => { setType('hiragana'); setSelected(hiragana[0]); }}
            className={cn(
              "px-8 py-3 rounded-full font-bold transition-all",
              type === 'hiragana' ? "bg-stone-900 text-white" : "text-stone-400 hover:text-stone-600"
            )}
          >
            Hiragana
          </button>
          <button 
            onClick={() => { setType('katakana'); setSelected(katakana[0]); }}
            className={cn(
              "px-8 py-3 rounded-full font-bold transition-all",
              type === 'katakana' ? "bg-stone-900 text-white" : "text-stone-400 hover:text-stone-600"
            )}
          >
            Katakana
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-12">
        <div className="lg:col-span-3 bg-white p-8 rounded-[3rem] shadow-sm border border-stone-50">
          <div className="grid grid-cols-5 sm:grid-cols-8 gap-3">
            {data.map((k) => (
              <button
                key={k.kana}
                onClick={() => setSelected(k)}
                className={cn(
                  "aspect-square flex flex-col items-center justify-center rounded-2xl transition-all border",
                  selected.kana === k.kana 
                    ? "bg-stone-900 border-stone-900 text-white shadow-lg" 
                    : "bg-stone-50 border-transparent text-stone-400 hover:bg-stone-100 hover:text-stone-900"
                )}
              >
                <span className="text-2xl font-serif">{k.kana}</span>
                <span className="text-[10px] font-mono uppercase tracking-widest opacity-60">{k.romaji}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-8">
          <div className="bg-white p-10 rounded-[3rem] shadow-sm border border-stone-50 text-center relative overflow-hidden">
            <div className="absolute top-6 right-6">
              <button 
                onClick={() => play(selected.kana)}
                disabled={ttsLoading}
                className="p-3 bg-stone-50 rounded-full text-stone-400 hover:text-stone-900 transition-all"
              >
                <Volume2 className={cn("w-5 h-5", ttsLoading && "animate-pulse")} />
              </button>
            </div>
            <span className="text-8xl font-serif text-stone-900 block mb-2">{selected.kana}</span>
            <span className="text-stone-400 font-mono tracking-[0.4em] uppercase text-sm">{selected.romaji}</span>
            
            <div className="mt-10">
              <DrawingCanvas key={selected.kana} target={selected.kana} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
const VocabEntry = ({ vocab }: { vocab: Vocabulary[] }) => {
  const { user, isDemo } = useContext(AuthContext);
  const [japanese, setJapanese] = useState('');
  const [meaning, setMeaning] = useState('');
  const [romaji, setRomaji] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const { play, loading: ttsLoading } = useTTS();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!japanese || !meaning) return;
    if (!isDemo && !user) return;
    
    setLoading(true);
    try {
      if (isDemo) {
        const localVocab = JSON.parse(localStorage.getItem('komorebi_vocab') || '[]');
        const newVocab = {
          id: Math.random().toString(36).substr(2, 9),
          uid: 'guest',
          japanese,
          meaning,
          romaji,
          createdAt: Timestamp.now(),
          mastery: 0
        };
        localStorage.setItem('komorebi_vocab', JSON.stringify([newVocab, ...localVocab]));
        window.dispatchEvent(new Event('vocab_update'));
      } else if (user) {
        const vocabRef = collection(db, 'users', user.uid, 'vocabularies');
        await addDoc(vocabRef, {
          uid: user.uid,
          japanese,
          meaning,
          romaji,
          createdAt: Timestamp.now(),
          mastery: 0
        });
      }
      
      setJapanese('');
      setMeaning('');
      setRomaji('');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (error) {
      if (!isDemo && user) handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/vocabularies`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-12">
      <div className="xl:col-span-2">
        <div className="mb-10">
          <h2 className="text-4xl font-editorial italic text-stone-900 mb-2">New Word</h2>
          <p className="text-stone-500 font-serif italic">Build your personal dictionary, one word at a time.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white p-10 rounded-[3rem] shadow-sm border border-stone-50 space-y-8">
          <div className="space-y-3">
            <label className="text-[10px] font-bold uppercase tracking-[0.3em] text-stone-400">Japanese (Kanji/Kana)</label>
            <input 
              value={japanese}
              onChange={(e) => setJapanese(e.target.value)}
              placeholder="e.g. 木漏れ日"
              className="w-full p-5 bg-stone-50 border-none rounded-2xl focus:ring-2 focus:ring-stone-100 transition-all text-2xl font-serif"
              required
            />
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-bold uppercase tracking-[0.3em] text-stone-400">Romaji</label>
            <input 
              value={romaji}
              onChange={(e) => setRomaji(e.target.value)}
              placeholder="e.g. Komorebi"
              className="w-full p-5 bg-stone-50 border-none rounded-2xl focus:ring-2 focus:ring-stone-100 transition-all font-mono text-sm"
            />
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-bold uppercase tracking-[0.3em] text-stone-400">Meaning</label>
            <input 
              value={meaning}
              onChange={(e) => setMeaning(e.target.value)}
              placeholder="e.g. Sunlight filtering through leaves"
              className="w-full p-5 bg-stone-50 border-none rounded-2xl focus:ring-2 focus:ring-stone-100 transition-all font-editorial italic text-lg"
              required
            />
          </div>
          <button 
            disabled={loading}
            className={cn(
              "w-full py-5 rounded-full font-bold transition-all flex items-center justify-center gap-3 text-lg shadow-xl shadow-stone-100",
              success ? "bg-emerald-500 text-white" : "bg-stone-900 text-white hover:bg-stone-800"
            )}
          >
            {loading ? "Adding..." : success ? <><CheckCircle2 className="w-6 h-6" /> Added!</> : <><PlusCircle className="w-6 h-6" /> Add Word</>}
          </button>
        </form>
      </div>

      <div className="xl:col-span-3">
        <div className="mb-10 flex items-center justify-between">
          <h2 className="text-4xl font-editorial italic text-stone-900">Recent Words</h2>
          <span className="text-stone-400 font-mono text-xs uppercase tracking-widest">{vocab.length} Total</span>
        </div>

        <div className="space-y-4 max-h-[600px] overflow-y-auto pr-4 custom-scrollbar">
          {vocab.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-[3rem] border border-stone-50">
              <p className="text-stone-400 font-editorial italic">Your list is empty. Add your first word!</p>
            </div>
          ) : (
            vocab.map((v) => (
              <motion.div 
                key={v.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="group bg-white p-6 rounded-3xl border border-stone-50 shadow-sm hover:shadow-md transition-all flex items-center justify-between"
              >
                <div className="flex items-center gap-6">
                  <div className="w-14 h-14 bg-stone-50 rounded-2xl flex items-center justify-center text-2xl font-serif text-stone-900 group-hover:bg-stone-900 group-hover:text-white transition-colors">
                    {v.japanese[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-serif text-stone-900">{v.japanese}</span>
                      <span className="text-stone-400 font-mono text-[10px] uppercase tracking-widest">{v.romaji}</span>
                    </div>
                    <p className="text-stone-500 font-editorial italic">{v.meaning}</p>
                  </div>
                </div>
                <button 
                  onClick={() => play(v.japanese)}
                  disabled={ttsLoading}
                  className="p-3 text-stone-300 hover:text-stone-900 hover:bg-stone-50 rounded-full transition-all"
                >
                  <Volume2 className={cn("w-5 h-5", ttsLoading && "animate-pulse")} />
                </button>
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

const Dictionary = () => {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { play, loading: ttsLoading } = useTTS();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query) return;
    setLoading(true);
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.error("Gemini API Key is missing");
        return;
      }
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Act as a professional Japanese-English dictionary. Provide a concise, structured definition for "${query}". 
        Include:
        1. Kanji/Kana
        2. Romaji
        3. Clear, brief English definition
        4. One natural example sentence with translation.
        Format as clean Markdown with clear headings. Avoid long paragraphs.`,
        config: {
          tools: [{ googleSearch: {} }]
        }
      });
      setResult(response.text || "No results found.");
    } catch (error) {
      console.error("AI Error:", error);
      setResult("Sorry, I couldn't find that word. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h2 className="text-3xl font-serif font-light text-stone-900">Japanese Dictionary</h2>
        <p className="text-stone-500 font-serif italic">Powered by AI and Google Search for precise translations.</p>
      </div>

      <form onSubmit={handleSearch} className="relative mb-8">
        <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-stone-400 w-5 h-5" />
        <input 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search in Japanese or English..."
          className="w-full p-6 pl-16 bg-white border-2 border-stone-100 rounded-[2rem] shadow-sm focus:border-stone-900 transition-all text-lg outline-none"
        />
        <button 
          type="submit"
          className="absolute right-3 top-1/2 -translate-y-1/2 px-6 py-3 bg-stone-900 text-white rounded-full font-bold hover:bg-stone-800 transition-colors"
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

      <AnimatePresence mode="wait">
        {result && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-white p-8 rounded-[2rem] shadow-sm border border-stone-100 relative"
          >
            <div className="absolute top-6 right-6">
              <button 
                onClick={() => {
                  const lines = result.split('\n').filter(l => l.trim().length > 0);
                  const japaneseLine = lines.find(l => /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(l));
                  play(japaneseLine || lines[0]);
                }}
                disabled={ttsLoading}
                className="p-3 bg-stone-50 rounded-full text-stone-400 hover:text-stone-900 transition-all"
              >
                <Volume2 className={cn("w-5 h-5", ttsLoading && "animate-pulse")} />
              </button>
            </div>
            <div className="prose prose-stone max-w-none">
              <ReactMarkdown>{result}</ReactMarkdown>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const Flashcards = ({ vocab }: { vocab: Vocabulary[] }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const { play, loading: ttsLoading } = useTTS();

  if (vocab.length === 0) {
    return (
      <div className="text-center py-20">
        <BookOpen className="w-16 h-16 text-stone-200 mx-auto mb-4" />
        <h3 className="text-2xl font-editorial italic text-stone-900 mb-2">Your collection is empty</h3>
        <p className="text-stone-500 font-serif italic">Add some words to start reviewing with flashcards.</p>
      </div>
    );
  }

  const current = vocab[currentIndex];

  return (
    <div className="max-w-md mx-auto py-12">
      <div className="mb-8 flex justify-between items-center">
        <h2 className="text-3xl font-editorial italic text-stone-900">Review</h2>
        <span className="text-stone-400 font-mono text-sm">{currentIndex + 1} / {vocab.length}</span>
      </div>

      <div 
        className="relative h-96 w-full perspective-1000 cursor-pointer"
        onClick={() => setIsFlipped(!isFlipped)}
      >
        <motion.div
          animate={{ rotateY: isFlipped ? 180 : 0 }}
          transition={{ duration: 0.6, type: "spring", stiffness: 260, damping: 20 }}
          className="w-full h-full relative preserve-3d"
        >
          {/* Front */}
          <div className="absolute inset-0 backface-hidden bg-white rounded-[2.5rem] shadow-xl border border-stone-100 flex flex-col items-center justify-center p-12 text-center">
            <div className="absolute top-6 right-6">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  play(current.japanese);
                }}
                disabled={ttsLoading}
                className="p-3 bg-stone-50 rounded-full text-stone-400 hover:text-stone-900 transition-all"
              >
                <Volume2 className={cn("w-5 h-5", ttsLoading && "animate-pulse")} />
              </button>
            </div>
            <span className="text-6xl font-serif mb-4 text-stone-900">{current.japanese}</span>
            <span className="text-stone-400 font-mono tracking-widest uppercase text-xs">{current.romaji}</span>
            <p className="mt-12 text-stone-300 text-xs uppercase tracking-widest font-bold">Click to flip</p>
          </div>

          {/* Back */}
          <div 
            className="absolute inset-0 backface-hidden bg-stone-900 rounded-[2.5rem] shadow-xl flex flex-col items-center justify-center p-12 text-center"
            style={{ transform: 'rotateY(180deg)' }}
          >
            <span className="text-3xl font-editorial italic text-white mb-4">{current.meaning}</span>
            <p className="mt-12 text-stone-500 text-xs uppercase tracking-widest font-bold">Click to flip back</p>
          </div>
        </motion.div>
      </div>

      <div className="mt-12 flex justify-between gap-4">
        <button 
          onClick={(e) => {
            e.stopPropagation();
            setIsFlipped(false);
            setCurrentIndex(prev => (prev === 0 ? vocab.length - 1 : prev - 1));
          }}
          className="flex-1 py-4 bg-white border border-stone-200 text-stone-600 rounded-full font-bold hover:bg-stone-50 transition-all"
        >
          Previous
        </button>
        <button 
          onClick={(e) => {
            e.stopPropagation();
            setIsFlipped(false);
            setCurrentIndex(prev => (prev === vocab.length - 1 ? 0 : prev + 1));
          }}
          className="flex-1 py-4 bg-stone-900 text-white rounded-full font-bold hover:bg-stone-800 transition-all shadow-lg shadow-stone-200"
        >
          Next
        </button>
      </div>
    </div>
  );
};

const Quiz = ({ vocab }: { vocab: Vocabulary[] }) => {
  const [currentQuestion, setCurrentQuestion] = useState<number>(0);
  const [score, setScore] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const { play, loading: ttsLoading } = useTTS();

  useEffect(() => {
    if (vocab.length >= 4 && !showResult) {
      generateQuestion();
    }
  }, [currentQuestion, vocab, showResult]);

  const generateQuestion = () => {
    const current = vocab[currentQuestion % vocab.length];
    const others = vocab.filter(v => v.id !== current.id);
    const shuffledOthers = [...others].sort(() => 0.5 - Math.random());
    const choices = [current.meaning, ...shuffledOthers.slice(0, 3).map(v => v.meaning)];
    setOptions(choices.sort(() => 0.5 - Math.random()));
    setSelectedOption(null);
    setIsCorrect(null);
  };

  const handleAnswer = (option: string) => {
    if (selectedOption) return;
    const current = vocab[currentQuestion % vocab.length];
    const correct = option === current.meaning;
    setSelectedOption(option);
    setIsCorrect(correct);
    if (correct) setScore(score + 1);

    setTimeout(() => {
      if (currentQuestion + 1 >= Math.min(vocab.length, 10)) {
        setShowResult(true);
      } else {
        setCurrentQuestion(currentQuestion + 1);
      }
    }, 1500);
  };

  if (vocab.length < 4) {
    return (
      <div className="text-center py-20 bg-white rounded-[3rem] border border-stone-50">
        <Brain className="w-16 h-16 text-stone-200 mx-auto mb-6" />
        <h3 className="text-2xl font-editorial italic text-stone-900 mb-2">Not enough words</h3>
        <p className="text-stone-500 font-serif italic">You need at least 4 words in your library to start a quiz.</p>
      </div>
    );
  }

  if (showResult) {
    return (
      <div className="max-w-xl mx-auto text-center py-20 bg-white rounded-[3rem] border border-stone-50 shadow-sm">
        <Trophy className="w-20 h-20 text-yellow-500 mx-auto mb-8 animate-bounce" />
        <h2 className="text-5xl font-editorial italic text-stone-900 mb-4">Quiz Complete!</h2>
        <p className="text-2xl text-stone-500 font-serif mb-12">You scored {score} out of {Math.min(vocab.length, 10)}</p>
        <button 
          onClick={() => {
            setCurrentQuestion(0);
            setScore(0);
            setShowResult(false);
          }}
          className="px-12 py-5 bg-stone-900 text-white rounded-full font-bold hover:bg-stone-800 transition-all shadow-xl shadow-stone-100"
        >
          Try Again
        </button>
      </div>
    );
  }

  const current = vocab[currentQuestion % vocab.length];

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-12 flex justify-between items-end">
        <div>
          <h2 className="text-4xl font-editorial italic text-stone-900 mb-2">Quiz</h2>
          <p className="text-stone-500 font-serif italic">Test your knowledge of your library.</p>
        </div>
        <div className="text-right">
          <span className="text-stone-400 font-mono text-xs uppercase tracking-widest block mb-1">Progress</span>
          <span className="text-2xl font-serif text-stone-900">{currentQuestion + 1} / {Math.min(vocab.length, 10)}</span>
        </div>
      </div>

      <div className="bg-white p-12 rounded-[3rem] shadow-sm border border-stone-50 mb-12 text-center relative">
        <div className="absolute top-6 right-6">
          <button 
            onClick={() => play(current.japanese)}
            disabled={ttsLoading}
            className="p-3 bg-stone-50 rounded-full text-stone-400 hover:text-stone-900 transition-all"
          >
            <Volume2 className={cn("w-5 h-5", ttsLoading && "animate-pulse")} />
          </button>
        </div>
        <span className="text-stone-400 font-mono text-xs uppercase tracking-widest block mb-8">What does this mean?</span>
        <h3 className="text-7xl font-serif text-stone-900 mb-4">{current.japanese}</h3>
        <p className="text-stone-400 font-mono tracking-[0.3em] uppercase">{current.romaji}</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {options.map((option, idx) => (
          <button
            key={idx}
            onClick={() => handleAnswer(option)}
            className={cn(
              "w-full p-6 text-left rounded-3xl border-2 transition-all flex items-center justify-between group",
              selectedOption === option
                ? isCorrect 
                  ? "bg-emerald-50 border-emerald-500 text-emerald-900" 
                  : "bg-red-50 border-red-500 text-red-900"
                : selectedOption && option === current.meaning
                  ? "bg-emerald-50 border-emerald-500 text-emerald-900"
                  : "bg-white border-stone-50 hover:border-stone-900 text-stone-600"
            )}
          >
            <span className="text-lg font-editorial italic">{option}</span>
            {selectedOption === option && (
              isCorrect ? <CheckCircle2 className="w-6 h-6" /> : <XCircle className="w-6 h-6" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'vocab' | 'vocabList' | 'quiz' | 'dictionary' | 'flashcards' | 'translator' | 'kana'>('dashboard');
  const [vocab, setVocab] = useState<Vocabulary[]>([]);
  const [todayVocabCount, setTodayVocabCount] = useState(0);
  const [isDemo, setIsDemo] = useState(localStorage.getItem('komorebi_demo') === 'true');

  const setDemoMode = (val: boolean) => {
    setIsDemo(val);
    if (val) {
      localStorage.setItem('komorebi_demo', 'true');
      // Initialize demo profile if not exists
      if (!localStorage.getItem('komorebi_profile')) {
        const demoProfile: UserProfile = {
          uid: 'guest',
          displayName: 'Guest Learner',
          email: 'guest@example.com',
          streakCount: 0,
          lastActiveDate: Timestamp.now(),
          dailyGoalMet: false,
          xp: 0
        };
        localStorage.setItem('komorebi_profile', JSON.stringify(demoProfile));
      }
    } else {
      localStorage.removeItem('komorebi_demo');
    }
  };

  useEffect(() => {
    // Safety timeout for loading state
    const timeout = setTimeout(() => {
      if (loading) {
        console.log("Loading timeout reached, defaulting to demo mode...");
        setLoading(false);
      }
    }, 3000);

    if (isDemo) {
      const loadDemoData = () => {
        const p = JSON.parse(localStorage.getItem('komorebi_profile') || '{}');
        const v = JSON.parse(localStorage.getItem('komorebi_vocab') || '[]');
        
        // Convert plain objects back to Timestamp-like if needed for consistency
        const vocabList = v.map((item: any) => ({
          ...item,
          createdAt: item.createdAt?.seconds ? new Timestamp(item.createdAt.seconds, item.createdAt.nanoseconds) : Timestamp.now()
        }));

        setProfile({
          uid: 'guest',
          displayName: 'Guest Learner',
          email: 'guest@example.com',
          streakCount: 0,
          dailyGoalMet: false,
          xp: 0,
          ...p,
          lastActiveDate: p.lastActiveDate?.seconds ? new Timestamp(p.lastActiveDate.seconds, p.lastActiveDate.nanoseconds) : Timestamp.now()
        });
        setVocab(vocabList);
        setTodayVocabCount(vocabList.filter((item: any) => isToday(item.createdAt.toDate())).length);
        setLoading(false);
        clearTimeout(timeout);
      };

      loadDemoData();
      window.addEventListener('vocab_update', loadDemoData);
      return () => {
        window.removeEventListener('vocab_update', loadDemoData);
        clearTimeout(timeout);
      };
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        clearTimeout(timeout);
        // Initial connection test
        try {
          await getDocFromServer(doc(db, 'users', currentUser.uid));
        } catch (e) {
          console.error("Firebase connection test failed", e);
        }

        // Listen to profile
        const profileRef = doc(db, 'users', currentUser.uid);
        const unsubProfile = onSnapshot(profileRef, (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data() as UserProfile;
            setProfile(data);

            // Check streak logic
            const lastDate = data.lastActiveDate?.toDate();
            if (lastDate && !isToday(lastDate)) {
              const diff = differenceInDays(startOfDay(new Date()), startOfDay(lastDate));
              if (diff > 1) {
                // Streak broken
                updateDoc(profileRef, { streakCount: 0, dailyGoalMet: false });
              } else {
                // New day, reset goal
                updateDoc(profileRef, { dailyGoalMet: false });
              }
            }
          } else {
            // Create profile
            const newProfile: UserProfile = {
              uid: currentUser.uid,
              displayName: currentUser.displayName,
              email: currentUser.email,
              streakCount: 0,
              lastActiveDate: Timestamp.now(),
              dailyGoalMet: false,
              xp: 0
            };
            setDoc(profileRef, newProfile);
            setProfile(newProfile);
          }
        }, (err) => handleFirestoreError(err, OperationType.GET, `users/${currentUser.uid}`));

        // Listen to vocab
        const vocabRef = collection(db, 'users', currentUser.uid, 'vocabularies');
        const q = query(vocabRef, orderBy('createdAt', 'desc'));
        const unsubVocab = onSnapshot(q, (snapshot) => {
          const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Vocabulary));
          setVocab(list);
          
          const todayCount = list.filter(v => isToday(v.createdAt.toDate())).length;
          setTodayVocabCount(todayCount);

          if (todayCount >= 5 && !profile?.dailyGoalMet) {
            updateDoc(profileRef, { 
              dailyGoalMet: true, 
              streakCount: (profile?.streakCount || 0) + 1,
              lastActiveDate: Timestamp.now(),
              xp: (profile?.xp || 0) + 50
            });
          }
        }, (err) => handleFirestoreError(err, OperationType.GET, `users/${currentUser.uid}/vocabularies`));

        return () => {
          unsubProfile();
          unsubVocab();
        };
      } else {
        // No user, load demo data
        const p = JSON.parse(localStorage.getItem('komorebi_profile') || '{}');
        const v = JSON.parse(localStorage.getItem('komorebi_vocab') || '[]');
        
        const vocabList = v.map((item: any) => ({
          ...item,
          createdAt: item.createdAt?.seconds ? new Timestamp(item.createdAt.seconds, item.createdAt.nanoseconds) : Timestamp.now()
        }));

        setProfile({
          uid: 'guest',
          displayName: 'Guest Learner',
          email: 'guest@example.com',
          streakCount: 0,
          dailyGoalMet: false,
          xp: 0,
          ...p,
          lastActiveDate: p.lastActiveDate?.seconds ? new Timestamp(p.lastActiveDate.seconds, p.lastActiveDate.nanoseconds) : Timestamp.now()
        });
        setVocab(vocabList);
        setTodayVocabCount(vocabList.filter((item: any) => isToday(item.createdAt.toDate())).length);
      }
      setLoading(false);
      clearTimeout(timeout);
    });

    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, [profile?.dailyGoalMet, profile?.streakCount, profile?.xp, isDemo]);

  const signIn = async () => {
    const provider = new GoogleAuthProvider();
    // Force account selection to avoid auto-login issues in some browsers
    provider.setCustomParameters({ prompt: 'select_account' });
    
    try {
      console.log("Attempting Google Sign-In...");
      const result = await signInWithPopup(auth, provider);
      console.log("Sign-In Success:", result.user.email);
      setIsDemo(false);
      localStorage.removeItem('komorebi_demo');
    } catch (error: any) {
      console.error("Login Error Details:", {
        code: error.code,
        message: error.message,
        customData: error.customData,
      });
      
      if (error.code === 'auth/popup-blocked') {
        throw new Error("The login popup was blocked by your browser. Please allow popups for this site and try again.");
      } else if (error.code === 'auth/unauthorized-domain') {
        throw new Error("This domain is not authorized for Firebase Authentication. Please check your Firebase Console settings.");
      } else {
        throw error;
      }
    }
  };

  const logout = async () => {
    if (isDemo) {
      setDemoMode(false);
    } else {
      await signOut(auth);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f2ed]">
        <div className="w-12 h-12 border-4 border-stone-200 border-t-stone-900 rounded-full animate-spin" />
      </div>
    );
  }

  // Default to demo mode if not logged in
  const effectiveIsDemo = isDemo || !user;

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, logout, setDemoMode, isDemo: effectiveIsDemo }}>
      <ErrorBoundary>
        <div className="min-h-screen bg-[#f5f2ed] flex">
          {/* Sidebar */}
          <aside className="w-20 md:w-64 bg-white border-r border-stone-100 flex flex-col fixed h-full z-50">
            <div className="p-6 flex items-center gap-3">
              <div className="w-10 h-10 bg-stone-900 rounded-xl flex items-center justify-center text-white font-bold shrink-0">木</div>
              <span className="hidden md:block font-serif font-bold text-xl tracking-tight">Komorebi</span>
            </div>
            
            <nav className="flex-1 px-3 space-y-3 mt-8">
              {[
                { id: 'dashboard', icon: Flame, label: 'Home' },
                { id: 'vocab', icon: PlusCircle, label: 'Add Word' },
                { id: 'vocabList', icon: List, label: 'Library' },
                { id: 'flashcards', icon: ChevronRight, label: 'Review' },
                { id: 'quiz', icon: Brain, label: 'Quiz' },
                { id: 'dictionary', icon: Search, label: 'Dictionary' },
                { id: 'translator', icon: Languages, label: 'Translate' },
                { id: 'kana', icon: Pencil, label: 'Kana' },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as any)}
                  className={cn(
                    "w-full flex items-center gap-4 p-4 rounded-2xl transition-all group relative",
                    activeTab === item.id 
                      ? "bg-stone-900 text-white shadow-xl shadow-stone-200" 
                      : "text-stone-400 hover:bg-stone-50 hover:text-stone-900"
                  )}
                >
                  <item.icon className={cn("w-6 h-6", activeTab === item.id ? "text-white" : "text-stone-400 group-hover:text-stone-900")} />
                  <span className="hidden md:block font-medium text-sm tracking-wide">{item.label}</span>
                  {activeTab === item.id && (
                    <motion.div 
                      layoutId="active-pill"
                      className="absolute left-0 w-1 h-6 bg-white rounded-full md:hidden"
                    />
                  )}
                </button>
              ))}
            </nav>

            <div className="p-4 mt-auto">
              <button 
                onClick={logout}
                className="w-full flex items-center gap-4 p-4 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all"
              >
                <LogOut className="w-6 h-6" />
                <span className="hidden md:block font-medium">Logout</span>
              </button>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 ml-20 md:ml-64 p-6 md:p-12">
            <div className="max-w-5xl mx-auto">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  {activeTab === 'dashboard' && <Dashboard vocabCount={todayVocabCount} vocab={vocab} />}
                  {activeTab === 'vocab' && <VocabEntry vocab={vocab} />}
                  {activeTab === 'vocabList' && <VocabList vocab={vocab} />}
                  {activeTab === 'flashcards' && <Flashcards vocab={vocab} />}
                  {activeTab === 'quiz' && <Quiz vocab={vocab} />}
                  {activeTab === 'dictionary' && <Dictionary />}
                  {activeTab === 'translator' && <Translator />}
                  {activeTab === 'kana' && <KanaPractice />}
                </motion.div>
              </AnimatePresence>
            </div>
          </main>
        </div>
      </ErrorBoundary>
    </AuthContext.Provider>
  );
}
