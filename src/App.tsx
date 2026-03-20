import React, { useState, useEffect, createContext, useContext, useRef, useCallback } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  User, 
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile
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
import { UserProfile, Vocabulary, OperationType, FirestoreErrorInfo, Note } from './types';
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
  RotateCcw,
  Settings as SettingsIcon,
  Settings2,
  ChevronLeft,
  Book,
  Library,
  Layers,
  MessageSquare,
  Gamepad2,
  Play,
  Timer,
  Ear,
  RefreshCw,
  Zap,
  ArrowLeft,
  Check
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

// --- AI Key Management ---
const getApiKey = () => {
  // Try localStorage first (user manual entry)
  const localKey = typeof window !== 'undefined' ? localStorage.getItem('komorebi_gemini_key') : null;
  if (localKey) return localKey.trim();

  // Try GEMINI_API_KEY first, then GOOGLE_API_KEY, and GEMINI_API_EY as fallback
  const key = process.env.GEMINI_API_KEY || 
         process.env.GOOGLE_API_KEY ||
         process.env.GEMINI_API_EY ||
         (import.meta as any).env?.VITE_GEMINI_API_KEY || 
         (import.meta as any).env?.VITE_GOOGLE_API_KEY ||
         (import.meta as any).env?.VITE_GEMINI_API_EY ||
         '';
  return key.trim();
};

const getAI = () => {
  const primaryKey = getApiKey();
  const secondaryKey = (import.meta as any).env?.VITE_GEMINI_API_KEY_2 || '';
  
  // Simple rotation/fallback logic
  const keys = [primaryKey, secondaryKey].filter(Boolean);
  
  if (keys.length === 0) {
    console.warn("No Gemini API keys found in environment.");
    return null;
  }
  
  // Use primary by default, but could be extended to track failures
  try {
    const keyToUse = keys[0];
    console.log(`Initializing AI with key starting with: ${keyToUse.substring(0, 4)}...`);
    return new GoogleGenAI({ apiKey: keyToUse });
  } catch (error) {
    console.error("AI Initialization Error:", error);
    return null;
  }
};

// --- Hooks ---
const useTTS = () => {
  const [loading, setLoading] = useState(false);
  const [hasJaVoice, setHasJaVoice] = useState<boolean | null>(null);
  const [quotaExhausted, setQuotaExhausted] = useState(false);
  const [mode, setMode] = useState<'native' | 'gemini'>(() => {
    return (localStorage.getItem('komorebi_tts_mode') as 'native' | 'gemini') || 'native';
  });

  // Pre-warm voices
  useEffect(() => {
    const checkVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      const jaVoice = voices.find(v => v.lang.toLowerCase().includes('ja') || v.lang.toLowerCase().includes('jp'));
      setHasJaVoice(!!jaVoice);
    };

    checkVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = checkVoices;
    }
  }, []);

  const setTTSMode = (newMode: 'native' | 'gemini') => {
    setMode(newMode);
    localStorage.setItem('komorebi_tts_mode', newMode);
    if (newMode === 'gemini') setQuotaExhausted(false);
  };

  const playNative = (text: string) => {
    return new Promise<void>((resolve, reject) => {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ja-JP';
      utterance.rate = 0.85;

      const voices = window.speechSynthesis.getVoices();
      const jaVoice = voices.find(v => v.lang.toLowerCase().includes('ja')) || 
                      voices.find(v => v.lang.toLowerCase().includes('jp'));
      
      if (jaVoice) {
        utterance.voice = jaVoice;
      } else {
        console.warn("No Japanese voice found on this device. Using default.");
      }

      utterance.onstart = () => setLoading(true);
      utterance.onend = () => {
        setLoading(false);
        resolve();
      };
      utterance.onerror = (e) => {
        setLoading(false);
        reject(e);
      };

      window.speechSynthesis.speak(utterance);
    });
  };

  const playGemini = async (text: string) => {
    try {
      const ai = getAI();
      if (!ai) throw new Error("Gemini API Key is missing. Please add GEMINI_API_KEY to your secrets.");
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Say in Japanese: ${text}` }] }],
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
        const audio = new Audio(`data:audio/wav;base64,${base64Audio}`);
        return new Promise<void>((resolve, reject) => {
          audio.onplay = () => setLoading(true);
          audio.onended = () => {
            setLoading(false);
            resolve();
          };
          audio.onerror = (e) => {
            setLoading(false);
            reject(e);
          };
          audio.play().catch(reject);
        });
      } else {
        throw new Error("No audio content received from Gemini TTS");
      }
    } catch (error: any) {
      // Check for quota exhaustion (429)
      if (error?.message?.includes('429') || error?.status === 'RESOURCE_EXHAUSTED' || error?.message?.includes('quota')) {
        setQuotaExhausted(true);
        setMode('native'); // Auto-switch to native
      }
      throw error;
    }
  };

  const play = async (text: string) => {
    if (loading || !text) return;
    
    try {
      if (mode === 'gemini' && !quotaExhausted) {
        await playGemini(text);
      } else {
        await playNative(text);
      }
    } catch (error) {
      console.error("TTS Error:", error);
      // Fallback to native if gemini fails
      if (mode !== 'native') {
        console.log("Falling back to native TTS...");
        await playNative(text);
      }
    }
  };

  return { play, loading, mode, setTTSMode, hasJaVoice, quotaExhausted };
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

const TTSContext = createContext<{
  play: (text: string) => Promise<void>;
  loading: boolean;
  mode: 'native' | 'gemini';
  setTTSMode: (mode: 'native' | 'gemini') => void;
  hasJaVoice: boolean | null;
  quotaExhausted: boolean;
}>({
  play: async () => {},
  loading: false,
  mode: 'native',
  setTTSMode: () => {},
  hasJaVoice: null,
  quotaExhausted: false,
});

const TTSProvider = ({ children }: { children: React.ReactNode }) => {
  const tts = useTTS();
  return (
    <TTSContext.Provider value={tts}>
      {children}
    </TTSContext.Provider>
  );
};

const useTTSContext = () => useContext(TTSContext);

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
  const { setDemoMode, signIn } = useContext(AuthContext);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (isRegistering) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      setDemoMode(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await signIn();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f2ed] p-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full"
      >
        <div className="text-center mb-8">
          <div className="mb-6 inline-flex items-center justify-center w-20 h-20 bg-stone-900 rounded-3xl rotate-3 shadow-lg">
            <span className="text-4xl text-white font-bold">木</span>
          </div>
          <h1 className="text-5xl font-serif font-light text-stone-900 mb-4 tracking-tight">Komorebi</h1>
          <p className="text-stone-600 font-serif italic text-lg">
            "Sunlight filtering through the leaves." <br/>
            Your daily companion for mastering Japanese.
          </p>
        </div>

        <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-stone-100 space-y-6">
          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-stone-400 ml-2">Email Address</label>
              <input 
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-4 bg-stone-50 border-none rounded-2xl focus:ring-2 focus:ring-stone-200 outline-none transition-all"
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-stone-400 ml-2">Password</label>
              <input 
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-4 bg-stone-50 border-none rounded-2xl focus:ring-2 focus:ring-stone-200 outline-none transition-all"
                placeholder="••••••••"
                required
              />
            </div>
            {error && <p className="text-xs text-red-500 ml-2 italic">{error}</p>}
            <button 
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-stone-900 text-white rounded-full font-bold hover:bg-stone-800 transition-all shadow-lg disabled:opacity-50"
            >
              {loading ? 'Processing...' : isRegistering ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-stone-100"></div></div>
            <div className="relative flex justify-center text-[10px] uppercase tracking-widest text-stone-400"><span className="bg-white px-2">Or continue with</span></div>
          </div>

          <button 
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full py-4 bg-white border border-stone-200 text-stone-900 rounded-full font-bold hover:bg-stone-50 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Google
          </button>

          <div className="text-center space-y-4">
            <button 
              onClick={() => setIsRegistering(!isRegistering)}
              className="text-xs text-stone-400 hover:text-stone-900 transition-colors font-serif italic underline underline-offset-4"
            >
              {isRegistering ? 'Already have an account? Sign In' : "Don't have an account? Register"}
            </button>
            <div className="h-px bg-stone-50" />
            <button 
              onClick={() => setDemoMode(true)}
              className="text-sm font-bold text-stone-900 hover:text-stone-600 transition-colors"
            >
              Continue as Guest
            </button>
          </div>
        </div>

        <p className="mt-8 text-stone-400 text-[10px] font-serif italic text-center">
          Your progress is saved to your account. Guest data is saved locally.
        </p>
      </motion.div>
    </div>
  );
};

const Dashboard = ({ vocabCount, vocab }: { vocabCount: number, vocab: Vocabulary[] }) => {
  const { profile } = useContext(AuthContext);
  const streak = profile?.streakCount || 0;
  const goalMet = profile?.dailyGoalMet || false;
  const { play, loading: ttsLoading, mode, setTTSMode, hasJaVoice } = useTTSContext();
  const hasApiKey = !!getApiKey();

  const wordOfTheDay = vocab.length > 0 ? vocab[Math.floor(Math.random() * vocab.length)] : { japanese: "学習", romaji: "Gakushuu", meaning: "Study / Learning" };

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <button 
            onClick={() => (window as any).setActiveTab('settings')}
            className="text-3xl font-editorial italic text-stone-900 mb-0.5 hover:text-stone-600 transition-colors text-left"
          >
            Okaeri, <span className="font-medium">{profile?.displayName?.split(' ')[0] || 'Learner'}</span>
          </button>
          <div className="flex items-center gap-3">
            <p className="text-stone-500 font-serif italic text-xs">The path to mastery is paved with daily steps.</p>
            {!hasApiKey && (
              <span className="px-2 py-0.5 bg-amber-50 text-amber-600 text-[8px] font-bold rounded-full uppercase tracking-tighter border border-amber-100">
                AI Features Offline (No API Key)
              </span>
            )}
            {hasJaVoice === false && (
              <a 
                href="https://support.google.com/chrome/answer/95414" 
                target="_blank" 
                rel="noopener noreferrer"
                className="px-2 py-0.5 bg-red-50 text-red-500 text-[8px] font-bold rounded-full uppercase tracking-tighter hover:bg-red-100 transition-colors"
              >
                Fix: No Japanese Voice
              </a>
            )}
          </div>
        </motion.div>
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-3"
        >
          <div className="flex items-center gap-1.5 p-0.5 bg-white rounded-full border border-stone-100 shadow-sm">
            <button 
              onClick={() => setTTSMode('native')}
              className={cn(
                "px-3 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-widest transition-all",
                mode === 'native' ? "bg-stone-900 text-white" : "text-stone-400 hover:text-stone-600"
              )}
              title="Free, unlimited usage using your device's built-in voice"
            >
              Built-in
            </button>
            <button 
              onClick={() => setTTSMode('gemini')}
              className={cn(
                "px-3 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-widest transition-all",
                mode === 'gemini' ? "bg-stone-900 text-white" : "text-stone-400 hover:text-stone-600"
              )}
              title="High-quality AI Voice powered by Gemini"
            >
              AI Voice
            </button>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 bg-white text-orange-600 rounded-full border border-stone-100 shadow-sm">
            <Flame className="w-4 h-4 fill-orange-500" />
            <span className="font-bold text-base">{streak}</span>
          </div>
        </motion.div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          whileHover={{ y: -4, scale: 1.01 }}
          transition={{ duration: 0.4 }}
          className="lg:col-span-2 p-6 bg-white rounded-[2rem] shadow-sm border border-stone-50 flex flex-col justify-between min-h-[220px] relative overflow-hidden group"
        >
          <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none group-hover:scale-110 transition-transform duration-700">
            <BookOpen className="w-32 h-32" />
          </div>
          <div className="relative z-10">
            <span className="text-stone-400 font-mono text-[8px] uppercase tracking-widest block mb-4">Word of the Day</span>
            <div className="flex items-end gap-4 mb-2">
              <h3 className="text-6xl font-serif text-stone-900 tracking-tight">{wordOfTheDay.japanese}</h3>
              <button 
                onClick={() => play(wordOfTheDay.japanese)}
                disabled={ttsLoading}
                className="p-2 bg-stone-50 rounded-full text-stone-400 hover:text-stone-900 transition-all mb-2 hover:scale-110 active:scale-95"
              >
                <Volume2 className={cn("w-4 h-4", ttsLoading && "animate-pulse")} />
              </button>
            </div>
            <p className="text-stone-400 font-mono tracking-[0.3em] uppercase text-[10px] mb-4">{wordOfTheDay.romaji}</p>
            <p className="text-2xl font-editorial italic text-stone-600">{wordOfTheDay.meaning}</p>
          </div>
          <div className="mt-6 flex gap-2">
            <button 
              onClick={() => (window as any).setActiveTab('dictionary')}
              className="px-6 py-2.5 bg-stone-900 text-white rounded-full font-bold text-xs hover:bg-stone-800 transition-all shadow-md shadow-stone-100 hover:shadow-lg active:scale-95"
            >
              Dictionary
            </button>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          whileHover={{ y: -4, scale: 1.01 }}
          className="p-6 bg-[#fdfbf7] border border-stone-100 rounded-[2rem] shadow-sm flex flex-col justify-between min-h-[220px]"
        >
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400 mb-4">Daily Progress</h3>
            <p className="text-2xl font-editorial italic text-stone-800 leading-tight">
              {goalMet 
                ? "You've reached today's summit. Rest well, or keep climbing." 
                : "Five new words today. Each one is a seed for your future."}
            </p>
          </div>
          
          <div className="mt-8">
            <div className="h-3 w-full bg-stone-50 rounded-full overflow-hidden border border-stone-100">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${Math.min((vocabCount / 5) * 100, 100)}%` }}
                transition={{ duration: 1, ease: "easeOut" }}
                className="h-full bg-stone-900"
              />
            </div>
            <div className="mt-3 flex justify-between items-end">
              <p className="text-xs font-bold text-stone-900 uppercase tracking-widest">{vocabCount} / 5 words</p>
              {goalMet && (
                <motion.span 
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest"
                >
                  Goal Met
                </motion.span>
              )}
            </div>
          </div>
        </motion.div>

        <motion.div 
          whileHover={{ y: -2 }}
          className="p-6 bg-white border border-stone-100 rounded-[2rem] shadow-sm flex flex-col justify-between min-h-[220px]"
        >
          <div className="flex items-center gap-4 mb-6">
            <div className="p-3 bg-blue-50 rounded-2xl text-blue-600">
              <Brain className="w-6 h-6" />
            </div>
            <span className="font-mono text-xs uppercase tracking-widest text-stone-400">Quick Stats</span>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-stone-500 font-serif italic">Total Words</span>
              <span className="text-2xl font-editorial italic text-stone-900">{vocab.length}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-stone-500 font-serif italic">Mastery</span>
              <span className="text-2xl font-editorial italic text-stone-900">84%</span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

const VocabList = ({ vocab }: { vocab: Vocabulary[] }) => {
  const { user, isDemo } = useContext(AuthContext);
  const [search, setSearch] = useState('');
  const [editingVocab, setEditingVocab] = useState<Vocabulary | null>(null);
  const [editJapanese, setEditJapanese] = useState('');
  const [editMeaning, setEditMeaning] = useState('');
  const [editRomaji, setEditRomaji] = useState('');
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const { play, loading: ttsLoading } = useTTSContext();

  const filteredVocab = vocab.filter(v => 
    v.japanese.includes(search) || 
    v.meaning.toLowerCase().includes(search.toLowerCase()) || 
    (v.romaji && v.romaji.toLowerCase().includes(search.toLowerCase()))
  );

  const handleDelete = async (id: string) => {
    if (!id) return;
    setIsDeleting(id);
    try {
      if (isDemo) {
        const localVocab = JSON.parse(localStorage.getItem('komorebi_vocab') || '[]');
        const updatedVocab = localVocab.filter((v: any) => v.id !== id);
        localStorage.setItem('komorebi_vocab', JSON.stringify(updatedVocab));
        window.dispatchEvent(new Event('vocab_update'));
      } else if (user) {
        const vocabRef = doc(db, 'users', user.uid, 'vocabularies', id);
        await setDoc(vocabRef, { deleted: true }, { merge: true }); // Soft delete or actual delete
        // For this app, let's do actual delete
        const { deleteDoc } = await import('firebase/firestore');
        await deleteDoc(vocabRef);
      }
    } catch (error) {
      console.error("Delete Error:", error);
    } finally {
      setIsDeleting(null);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVocab || !editingVocab.id) return;
    
    try {
      if (isDemo) {
        const localVocab = JSON.parse(localStorage.getItem('komorebi_vocab') || '[]');
        const updatedVocab = localVocab.map((v: any) => 
          v.id === editingVocab.id 
            ? { ...v, japanese: editJapanese, meaning: editMeaning, romaji: editRomaji } 
            : v
        );
        localStorage.setItem('komorebi_vocab', JSON.stringify(updatedVocab));
        window.dispatchEvent(new Event('vocab_update'));
      } else if (user) {
        const vocabRef = doc(db, 'users', user.uid, 'vocabularies', editingVocab.id);
        await updateDoc(vocabRef, {
          japanese: editJapanese,
          meaning: editMeaning,
          romaji: editRomaji
        });
      }
      setEditingVocab(null);
    } catch (error) {
      console.error("Update Error:", error);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-editorial italic text-stone-900 mb-1">Vocabulary Library</h2>
          <p className="text-stone-500 font-serif italic text-xs">Your personal collection of words and phrases.</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-white text-stone-900 rounded-full border border-stone-100 shadow-sm self-start">
          <BookOpen className="w-4 h-4 text-stone-400" />
          <div className="flex flex-col leading-none">
            <span className="font-bold text-base">{vocab.length}</span>
            <span className="text-[7px] font-bold uppercase tracking-widest text-stone-400">Total Words</span>
          </div>
        </div>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400 w-4 h-4" />
        <input 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="w-full p-4 pl-12 bg-white border border-stone-100 rounded-2xl shadow-sm focus:border-stone-900 transition-all text-base outline-none"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filteredVocab.length === 0 ? (
          <div className="col-span-full text-center py-12 bg-white rounded-[2rem] border border-stone-50">
            <p className="text-stone-400 font-editorial italic text-sm">No words found matching your search.</p>
          </div>
        ) : (
          filteredVocab.map((v) => (
            <motion.div 
              key={v.id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="group bg-white p-4 rounded-2xl border border-stone-100 shadow-sm hover:shadow-md transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-stone-50 rounded-xl flex items-center justify-center text-lg font-serif text-stone-900 group-hover:bg-stone-900 group-hover:text-white transition-colors shrink-0">
                  {v.japanese[0]}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg font-serif text-stone-900">{v.japanese}</span>
                    <span className="text-stone-400 font-mono text-[8px] uppercase tracking-widest">{v.romaji}</span>
                    <div className="px-1.5 py-0.5 bg-stone-50 rounded text-[7px] font-bold text-stone-400 uppercase tracking-tighter">
                      {v.mastery}%
                    </div>
                  </div>
                  <p className="text-stone-500 font-editorial italic text-sm">{v.meaning}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 justify-end border-t sm:border-t-0 pt-3 sm:pt-0">
                <button 
                  onClick={() => play(v.japanese)}
                  disabled={ttsLoading}
                  className="p-2 text-stone-400 hover:text-stone-900 hover:bg-stone-50 rounded-full transition-all"
                  title="Speak"
                >
                  <Volume2 className={cn("w-4 h-4", ttsLoading && "animate-pulse")} />
                </button>
                <button 
                  onClick={() => {
                    setEditingVocab(v);
                    setEditJapanese(v.japanese);
                    setEditMeaning(v.meaning);
                    setEditRomaji(v.romaji || '');
                  }}
                  className="p-3 text-stone-400 hover:text-stone-900 hover:bg-stone-50 rounded-full transition-all"
                  title="Edit"
                >
                  <Pencil className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => v.id && handleDelete(v.id)}
                  disabled={isDeleting === v.id}
                  className="p-3 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"
                  title="Delete"
                >
                  <Trash2 className={cn("w-5 h-5", isDeleting === v.id && "animate-pulse")} />
                </button>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* Edit Modal */}
      <AnimatePresence>
        {editingVocab && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingVocab(null)}
              className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-[3rem] shadow-2xl p-10 overflow-hidden"
            >
              <h3 className="text-3xl font-editorial italic text-stone-900 mb-8">Edit Word</h3>
              <form onSubmit={handleUpdate} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Japanese</label>
                  <input 
                    value={editJapanese}
                    onChange={(e) => setEditJapanese(e.target.value)}
                    className="w-full p-4 bg-stone-50 rounded-2xl font-serif text-xl outline-none focus:ring-2 focus:ring-stone-100"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Romaji</label>
                  <input 
                    value={editRomaji}
                    onChange={(e) => setEditRomaji(e.target.value)}
                    className="w-full p-4 bg-stone-50 rounded-2xl font-mono text-sm outline-none focus:ring-2 focus:ring-stone-100"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Meaning</label>
                  <input 
                    value={editMeaning}
                    onChange={(e) => setEditMeaning(e.target.value)}
                    className="w-full p-4 bg-stone-50 rounded-2xl font-editorial italic outline-none focus:ring-2 focus:ring-stone-100"
                    required
                  />
                </div>
                <div className="flex gap-4 pt-4">
                  <button 
                    type="button"
                    onClick={() => setEditingVocab(null)}
                    className="flex-1 py-4 bg-stone-50 text-stone-600 rounded-full font-bold hover:bg-stone-100 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-4 bg-stone-900 text-white rounded-full font-bold hover:bg-stone-800 transition-all shadow-xl shadow-stone-200"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const Translator = () => {
  const [text, setText] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const { play, loading: ttsLoading } = useTTSContext();

  const handleTranslate = async () => {
    if (!text) return;
    
    const cacheKey = `translate_${text.trim().toLowerCase()}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      setResult(cached);
      return;
    }

    setLoading(true);
    try {
      const ai = getAI();
      if (!ai) {
        setResult("I need an API key to translate! Please add your `GEMINI_API_KEY` in the app settings (⚙️ icon -> Secrets).");
        return;
      }

      const isJapanese = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(text);
      
      const response = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: `Translate the following ${isJapanese ? "Japanese" : "English"} text to ${isJapanese ? "English" : "Japanese"}: "${text}". 
        Provide ONLY the translation. If it's a single word, provide the most common translation. 
        If it's Japanese, also include the Romaji in parentheses.`,
      });

      const translation = response.text?.trim() || "Translation failed";
      setResult(translation);
      localStorage.setItem(cacheKey, translation);
    } catch (error: any) {
      console.error("Translation Error:", error);
      setResult(`Error: ${error.message || "Something went wrong. Please try again."}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-10"
      >
        <h2 className="text-4xl font-editorial italic text-stone-900 mb-2">Word Translator</h2>
        <p className="text-stone-500 font-serif italic">Fast, reliable word translations powered by Gemini AI.</p>
      </motion.div>

      {!getApiKey() && <div className="mb-8"><MissingApiKeyWarning /></div>}

      <div className="space-y-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-8 rounded-[3rem] shadow-sm border border-stone-50"
        >
          <div className="relative">
            <input 
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTranslate()}
              placeholder="Type a word in English or Japanese..."
              className="w-full p-6 bg-stone-50 border-none rounded-2xl focus:ring-2 focus:ring-stone-100 transition-all text-xl outline-none font-serif italic"
            />
            {text && (
              <button 
                onClick={() => setText('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-stone-300 hover:text-stone-500 transition-all hover:scale-110"
              >
                <XCircle className="w-5 h-5" />
              </button>
            )}
          </div>
          <div className="mt-6 flex justify-end">
            <button 
              onClick={handleTranslate}
              disabled={loading || !text}
              className="px-10 py-4 bg-stone-900 text-white rounded-full font-bold hover:bg-stone-800 transition-all shadow-xl shadow-stone-100 disabled:opacity-50 flex items-center gap-2 hover:scale-105 active:scale-95"
            >
              {loading ? (
                <>
                  <RotateCcw className="w-4 h-4 animate-spin" />
                  Translating...
                </>
              ) : (
                <>
                  <Languages className="w-4 h-4" />
                  Translate
                </>
              )}
            </button>
          </div>
        </motion.div>

        <AnimatePresence mode="wait">
          {result && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white p-10 rounded-[3rem] shadow-sm border border-stone-50 relative"
            >
              <div className="absolute top-8 right-8">
                <button 
                  onClick={() => play(result)}
                  disabled={ttsLoading}
                  className="p-3 bg-stone-50 rounded-full text-stone-400 hover:text-stone-900 transition-all"
                >
                  <Volume2 className={cn("w-5 h-5", ttsLoading && "animate-pulse")} />
                </button>
              </div>
              <div className="text-3xl font-medium text-stone-900 leading-relaxed">
                {result}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

const DrawingCanvas = ({ 
  target, 
  showGhost = true, 
  initialData, 
  onSave, 
  onClear 
}: { 
  target: string, 
  showGhost?: boolean, 
  initialData?: string, 
  onSave?: (data: string) => void, 
  onClear?: () => void 
}) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [ctx, setCtx] = useState<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const context = canvas.getContext('2d');
    if (!context) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      context.scale(dpr, dpr);
      
      context.strokeStyle = '#1c1917';
      context.lineWidth = 6;
      context.lineCap = 'round';
      context.lineJoin = 'round';
    };

    resize();
    setCtx(context);

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Load initial data when target or ctx changes
  useEffect(() => {
    if (ctx && canvasRef.current) {
      if (initialData) {
        const img = new Image();
        img.onload = () => {
          ctx.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
          const dpr = window.devicePixelRatio || 1;
          ctx.drawImage(img, 0, 0, canvasRef.current!.width / dpr, canvasRef.current!.height / dpr);
        };
        img.src = initialData;
      } else {
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, canvasRef.current.width / dpr, canvasRef.current.height / dpr);
      }
    }
  }, [ctx, initialData, target]);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    if ('touches' in e) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      };
    } else {
      return {
        x: (e as React.MouseEvent).clientX - rect.left,
        y: (e as React.MouseEvent).clientY - rect.top
      };
    }
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (!ctx) return;
    setIsDrawing(true);
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    if ('touches' in e) {
      (e as React.TouchEvent).preventDefault();
    }
  };

  const stopDrawing = () => {
    if (isDrawing && onSave && canvasRef.current) {
      onSave(canvasRef.current.toDataURL());
    }
    setIsDrawing(false);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if ('touches' in e) {
      (e as React.TouchEvent).preventDefault();
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    if (onClear) onClear();
  };

  return (
    <div className="space-y-4">
      <div className="relative bg-white rounded-[2.5rem] border-2 border-stone-100 shadow-inner overflow-hidden aspect-square max-w-[320px] mx-auto touch-none">
        {showGhost && (
          <div className="absolute inset-0 flex items-center justify-center opacity-[0.05] pointer-events-none select-none">
            <span className="text-[14rem] font-serif">{target}</span>
          </div>
        )}
        <canvas 
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseOut={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className="w-full h-full cursor-crosshair relative z-10"
        />
      </div>
      <div className="flex justify-center">
        <button 
          onClick={clearCanvas}
          className="flex items-center gap-2 px-6 py-2 bg-stone-100 text-stone-600 rounded-full font-bold text-xs hover:bg-stone-200 transition-all active:scale-95"
        >
          <Eraser className="w-4 h-4" />
          Clear Canvas
        </button>
      </div>
    </div>
  );
};

const WritingPractice = () => {
  const [type, setType] = useState<'hiragana' | 'katakana'>('hiragana');
  const [selected, setSelected] = useState(hiragana[0]);
  const [practiceMode, setPracticeMode] = useState(false);
  const [autoClear, setAutoClear] = useState(true);
  const [drawings, setDrawings] = useState<Record<string, string>>({});
  const { play, loading: ttsLoading } = useTTSContext();

  const data = type === 'hiragana' ? hiragana : katakana;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-4 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-editorial italic text-stone-900 mb-0.5">Writing Practice</h2>
          <p className="text-stone-500 font-serif italic text-xs">Master the building blocks of Japanese.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex bg-white p-0.5 rounded-full border border-stone-100 shadow-sm">
            <button 
              onClick={() => { setType('hiragana'); setSelected(hiragana[0]); }}
              className={cn(
                "px-4 py-1.5 rounded-full font-bold text-xs transition-all whitespace-nowrap",
                type === 'hiragana' ? "bg-stone-900 text-white shadow-md" : "text-stone-400 hover:text-stone-600"
              )}
            >
              Hiragana
            </button>
            <button 
              onClick={() => { setType('katakana'); setSelected(katakana[0]); }}
              className={cn(
                "px-4 py-1.5 rounded-full font-bold text-xs transition-all whitespace-nowrap",
                type === 'katakana' ? "bg-stone-900 text-white shadow-md" : "text-stone-400 hover:text-stone-600"
              )}
            >
              Katakana
            </button>
          </div>
          
          <div className="flex bg-white p-0.5 rounded-full border border-stone-100 shadow-sm">
            <button 
              onClick={() => setPracticeMode(!practiceMode)}
              className={cn(
                "px-4 py-1.5 rounded-full font-bold text-xs transition-all whitespace-nowrap flex items-center gap-2",
                practiceMode ? "bg-emerald-600 text-white shadow-md" : "text-stone-400 hover:text-stone-600"
              )}
            >
              <Pencil className="w-3 h-3" />
              Practice Mode
            </button>
            <button 
              onClick={() => setAutoClear(!autoClear)}
              className={cn(
                "px-4 py-1.5 rounded-full font-bold text-xs transition-all whitespace-nowrap flex items-center gap-2",
                !autoClear ? "bg-amber-600 text-white shadow-md" : "text-stone-400 hover:text-stone-600"
              )}
            >
              <RotateCcw className="w-3 h-3" />
              Persistent
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 bg-white p-4 rounded-[2rem] shadow-sm border border-stone-50">
          <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
            {data.map((k) => (
              <button
                key={k.kana}
                onClick={() => setSelected(k)}
                className={cn(
                  "aspect-square flex flex-col items-center justify-center rounded-lg transition-all border",
                  selected.kana === k.kana 
                    ? "bg-stone-900 border-stone-900 text-white shadow-md" 
                    : "bg-stone-50 border-transparent text-stone-400 hover:bg-stone-100 hover:text-stone-900"
                )}
              >
                <span className="text-lg font-serif">{k.kana}</span>
                <span className="text-[8px] font-mono uppercase tracking-widest opacity-60">{k.romaji}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white p-4 rounded-[2rem] shadow-sm border border-stone-50 text-center relative overflow-hidden">
            <div className="absolute top-3 right-3">
              <button 
                onClick={() => play(selected.kana)}
                disabled={ttsLoading}
                className="p-1.5 bg-stone-50 rounded-full text-stone-400 hover:text-stone-900 transition-all"
              >
                <Volume2 className={cn("w-3.5 h-3.5", ttsLoading && "animate-pulse")} />
              </button>
            </div>
            
            <div className="min-h-[80px] flex flex-col items-center justify-center">
              {!practiceMode ? (
                <>
                  <span className="text-6xl font-serif text-stone-900 block mb-0.5">{selected.kana}</span>
                  <span className="text-stone-400 font-mono tracking-[0.3em] uppercase text-[10px]">{selected.romaji}</span>
                </>
              ) : (
                <>
                  <span className="text-stone-400 font-mono tracking-[0.3em] uppercase text-xs mb-2">Write this:</span>
                  <span className="text-4xl font-mono text-stone-900 font-bold uppercase tracking-widest">{selected.romaji}</span>
                </>
              )}
            </div>
            
            <div className="mt-4">
              <DrawingCanvas 
                key={selected.kana}
                target={selected.kana} 
                showGhost={!practiceMode} 
                initialData={autoClear ? undefined : drawings[selected.kana]}
                onSave={(data) => setDrawings(prev => ({ ...prev, [selected.kana]: data }))}
                onClear={() => setDrawings(prev => {
                  const next = { ...prev };
                  delete next[selected.kana];
                  return next;
                })}
              />
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
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateMatch, setDuplicateMatch] = useState<Vocabulary | null>(null);
  const { play, loading: ttsLoading } = useTTSContext();

  const handleSubmit = async (e?: React.FormEvent, isSubtype: boolean = false) => {
    if (e) e.preventDefault();
    if (!japanese || !meaning) return;
    if (!isDemo && !user) return;

    // Check for duplicate meaning if not already confirmed as subtype
    if (!isSubtype) {
      const existing = vocab.find(v => v.meaning.toLowerCase().trim() === meaning.toLowerCase().trim());
      if (existing) {
        setDuplicateMatch(existing);
        setShowDuplicateModal(true);
        return;
      }
    }
    
    setLoading(true);
    try {
      const vocabData = {
        uid: isDemo ? 'guest' : user!.uid,
        japanese,
        meaning,
        romaji,
        createdAt: Timestamp.now(),
        mastery: 0,
        type: isSubtype ? 'sub' : 'main' as 'main' | 'sub',
        parentId: isSubtype ? duplicateMatch?.id : undefined
      };

      if (isDemo) {
        const localVocab = JSON.parse(localStorage.getItem('komorebi_vocab') || '[]');
        const newVocab = {
          id: Math.random().toString(36).substr(2, 9),
          ...vocabData
        };
        localStorage.setItem('komorebi_vocab', JSON.stringify([newVocab, ...localVocab]));
        window.dispatchEvent(new Event('vocab_update'));
      } else if (user) {
        const vocabRef = collection(db, 'users', user.uid, 'vocabularies');
        await addDoc(vocabRef, vocabData);
      }
      
      setJapanese('');
      setMeaning('');
      setRomaji('');
      setSuccess(true);
      setShowDuplicateModal(false);
      setDuplicateMatch(null);
      setTimeout(() => setSuccess(false), 3000);
    } catch (error) {
      if (!isDemo && user) handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/vocabularies`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-8">
      {showDuplicateModal && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-[2.5rem] p-8 max-w-md w-full shadow-2xl border border-stone-100"
          >
            <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mb-6">
              <AlertCircle className="w-8 h-8 text-amber-500" />
            </div>
            <h3 className="text-2xl font-editorial italic text-stone-900 mb-2">Duplicate Meaning</h3>
            <p className="text-stone-500 font-serif italic text-sm mb-8">
              The meaning "<span className="text-stone-900 font-bold">{meaning}</span>" already exists for "<span className="text-stone-900 font-bold">{duplicateMatch?.japanese}</span>". 
              Would you like to add this as a sub-type of the existing word?
            </p>
            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => handleSubmit(undefined, true)}
                className="py-4 bg-stone-900 text-white rounded-full font-bold hover:bg-stone-800 transition-all"
              >
                Yes, Add Sub-type
              </button>
              <button 
                onClick={() => setShowDuplicateModal(false)}
                className="py-4 bg-stone-50 text-stone-900 rounded-full font-bold hover:bg-stone-100 transition-all"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}
      <div className="xl:col-span-2">
        <div className="mb-6">
          <h2 className="text-3xl font-editorial italic text-stone-900 mb-1">New Word</h2>
          <p className="text-stone-500 font-serif italic text-xs">Build your personal dictionary, one word at a time.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white p-6 rounded-[2rem] shadow-sm border border-stone-50 space-y-5">
          <div className="space-y-2">
            <label className="text-[9px] font-bold uppercase tracking-[0.3em] text-stone-400">Japanese (Kanji/Kana)</label>
            <input 
              value={japanese}
              onChange={(e) => setJapanese(e.target.value)}
              placeholder="e.g. 木漏れ日"
              className="w-full p-4 bg-stone-50 border-none rounded-xl focus:ring-2 focus:ring-stone-100 transition-all text-xl font-serif"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-[9px] font-bold uppercase tracking-[0.3em] text-stone-400">Romaji</label>
            <input 
              value={romaji}
              onChange={(e) => setRomaji(e.target.value)}
              placeholder="e.g. Komorebi"
              className="w-full p-4 bg-stone-50 border-none rounded-xl focus:ring-2 focus:ring-stone-100 transition-all font-mono text-xs"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[9px] font-bold uppercase tracking-[0.3em] text-stone-400">Meaning</label>
            <input 
              value={meaning}
              onChange={(e) => setMeaning(e.target.value)}
              placeholder="e.g. Sunlight filtering through leaves"
              className="w-full p-4 bg-stone-50 border-none rounded-xl focus:ring-2 focus:ring-stone-100 transition-all font-editorial italic text-base"
              required
            />
          </div>
          <button 
            disabled={loading}
            className={cn(
              "w-full py-4 rounded-full font-bold transition-all flex items-center justify-center gap-2 text-base shadow-lg shadow-stone-100",
              success ? "bg-emerald-500 text-white" : "bg-stone-900 text-white hover:bg-stone-800"
            )}
          >
            {loading ? "Adding..." : success ? <><CheckCircle2 className="w-5 h-5" /> Added!</> : <><PlusCircle className="w-5 h-5" /> Add Word</>}
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
            vocab.filter(v => v.type !== 'sub').map((v) => {
              const subs = vocab.filter(s => s.parentId === v.id);
              return (
                <div key={v.id} className="space-y-2">
                  <motion.div 
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
                  
                  {subs.length > 0 && (
                    <div className="ml-12 space-y-2 border-l-2 border-stone-100 pl-6">
                      {subs.map(sub => (
                        <motion.div 
                          key={sub.id}
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="bg-stone-50/50 p-4 rounded-2xl flex items-center justify-between group/sub"
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-lg font-serif text-stone-400 group-hover/sub:bg-stone-900 group-hover/sub:text-white transition-colors">
                              {sub.japanese[0]}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-lg font-serif text-stone-900">{sub.japanese}</span>
                                <span className="text-stone-400 font-mono text-[8px] uppercase tracking-widest">{sub.romaji}</span>
                                <span className="px-1.5 py-0.5 bg-amber-50 text-amber-600 text-[6px] font-bold uppercase tracking-widest rounded-full border border-amber-100">Sub</span>
                              </div>
                              <p className="text-stone-400 font-editorial italic text-sm">{sub.meaning}</p>
                            </div>
                          </div>
                          <button 
                            onClick={() => play(sub.japanese)}
                            disabled={ttsLoading}
                            className="p-2 text-stone-200 hover:text-stone-900 transition-all"
                          >
                            <Volume2 className="w-4 h-4" />
                          </button>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
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
  const [showCommon, setShowCommon] = useState(true);
  const { play, loading: ttsLoading } = useTTSContext();

  const commonWords = [
    { jp: "こんにちは", ro: "Konnichiwa", en: "Hello / Good afternoon" },
    { jp: "ありがとう", ro: "Arigatou", en: "Thank you" },
    { jp: "すみません", ro: "Sumimasen", en: "Excuse me / I'm sorry" },
    { jp: "はい", ro: "Hai", en: "Yes" },
    { jp: "いいえ", ro: "Iie", en: "No" },
    { jp: "おいしい", ro: "Oishii", en: "Delicious" },
    { jp: "かわいい", ro: "Kawaii", en: "Cute" },
    { jp: "さようなら", ro: "Sayounara", en: "Goodbye" },
  ];

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query) return;

    const cacheKey = `dict_${query.trim().toLowerCase()}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      setResult(cached);
      setShowCommon(false);
      return;
    }

    setLoading(true);
    setShowCommon(false);
    try {
      const ai = getAI();
      if (!ai) throw new Error("API Key not found. Please add GEMINI_API_KEY to your secrets.");

      const response = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: `Act as a professional Japanese-English dictionary. Provide a concise, structured definition for "${query}". 
        Include:
        1. Kanji/Kana
        2. Romaji
        3. Clear English definition
        4. One natural example sentence with translation.
        Format as clean Markdown with clear headings.`,
      });

      const definition = response.text?.trim() || "No results found.";
      setResult(definition);
      localStorage.setItem(cacheKey, definition);
    } catch (error: any) {
      console.error("AI Error:", error);
      setResult(`Sorry, I couldn't find that word. Error: ${error.message || "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h2 className="text-3xl font-editorial italic text-stone-900 mb-2">Japanese Dictionary</h2>
        <p className="text-stone-500 font-serif italic">Search for any word or browse common expressions below.</p>
      </motion.div>

      {!getApiKey() && <div className="mb-8"><MissingApiKeyWarning /></div>}

      <motion.form 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        onSubmit={handleSearch} 
        className="relative mb-8"
      >
        <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-stone-400 w-5 h-5" />
        <input 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search in Japanese or English..."
          className="w-full p-6 pl-16 bg-white border-2 border-stone-100 rounded-[2rem] shadow-sm focus:border-stone-900 transition-all text-lg outline-none font-serif italic"
        />
        <button 
          type="submit"
          disabled={loading || !query}
          className="absolute right-3 top-1/2 -translate-y-1/2 px-6 py-3 bg-stone-900 text-white rounded-full font-bold hover:bg-stone-800 transition-colors disabled:opacity-50 hover:scale-105 active:scale-95"
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </motion.form>

      <AnimatePresence mode="wait">
        {showCommon && !result && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            {commonWords.map((word, i) => (
              <button
                key={i}
                onClick={() => { setQuery(word.jp); setTimeout(() => handleSearch(), 100); }}
                className="p-6 bg-white border border-stone-100 rounded-2xl text-left hover:border-stone-300 transition-all group"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-2xl font-serif text-stone-900">{word.jp}</span>
                  <Volume2 
                    onClick={(e) => { e.stopPropagation(); play(word.jp); }}
                    className="w-4 h-4 text-stone-300 group-hover:text-stone-900 transition-colors" 
                  />
                </div>
                <div className="text-xs font-mono text-stone-400 uppercase tracking-widest mb-1">{word.ro}</div>
                <div className="text-sm text-stone-600 font-editorial italic">{word.en}</div>
              </button>
            ))}
          </motion.div>
        )}

        {result && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white p-8 rounded-[2rem] shadow-sm border border-stone-100 relative"
          >
            <div className="absolute top-6 right-6 flex gap-2">
              <button 
                onClick={() => { setResult(null); setShowCommon(true); setQuery(''); }}
                className="p-3 bg-stone-50 rounded-full text-stone-400 hover:text-stone-900 transition-all"
              >
                <RotateCcw className="w-5 h-5" />
              </button>
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
            <div className="prose prose-stone max-w-none prose-headings:font-editorial prose-headings:italic">
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
  const { play, loading: ttsLoading } = useTTSContext();

  if (vocab.length === 0) {
    return (
      <div className="text-center py-12">
        <BookOpen className="w-12 h-12 text-stone-200 mx-auto mb-4" />
        <h3 className="text-xl font-editorial italic text-stone-900 mb-1">Your collection is empty</h3>
        <p className="text-stone-500 font-serif italic text-sm">Add some words to start reviewing with flashcards.</p>
      </div>
    );
  }

  const current = vocab[currentIndex];

  return (
    <div className="max-w-md mx-auto py-2">
      <div className="mb-4 flex justify-between items-center">
        <h2 className="text-xl font-editorial italic text-stone-900">Review</h2>
        <span className="text-stone-400 font-mono text-[10px]">{currentIndex + 1} / {vocab.length}</span>
      </div>

      <div 
        className="relative h-64 w-full perspective-1000 cursor-pointer"
        onClick={() => setIsFlipped(!isFlipped)}
      >
        <motion.div
          animate={{ rotateY: isFlipped ? 180 : 0 }}
          transition={{ duration: 0.6, type: "spring", stiffness: 260, damping: 20 }}
          className="w-full h-full relative preserve-3d"
        >
          {/* Front */}
          <div className="absolute inset-0 backface-hidden bg-white rounded-[1.5rem] shadow-md border border-stone-100 flex flex-col items-center justify-center p-6 text-center">
            <div className="absolute top-3 right-3">
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  play(current.japanese);
                }}
                disabled={ttsLoading}
                className="p-1.5 bg-stone-50 rounded-full text-stone-400 hover:text-stone-900 transition-all"
              >
                <Volume2 className={cn("w-3.5 h-3.5", ttsLoading && "animate-pulse")} />
              </button>
            </div>
            <span className="text-4xl font-serif mb-1 text-stone-900">{current.japanese}</span>
            <span className="text-stone-400 font-mono tracking-widest uppercase text-[8px]">{current.romaji}</span>
            <p className="mt-6 text-stone-300 text-[8px] uppercase tracking-widest font-bold">Click to flip</p>
          </div>

          {/* Back */}
          <div 
            className="absolute inset-0 backface-hidden bg-stone-900 rounded-[1.5rem] shadow-md flex flex-col items-center justify-center p-6 text-center"
            style={{ transform: 'rotateY(180deg)' }}
          >
            <span className="text-xl font-editorial italic text-white mb-1">{current.meaning}</span>
            <p className="mt-6 text-stone-500 text-[8px] uppercase tracking-widest font-bold">Click to flip back</p>
          </div>
        </motion.div>
      </div>

      <div className="mt-6 flex justify-between gap-2">
        <button 
          onClick={(e) => {
            e.stopPropagation();
            setIsFlipped(false);
            setCurrentIndex(prev => (prev === 0 ? vocab.length - 1 : prev - 1));
          }}
          className="flex-1 py-2.5 bg-white border border-stone-200 text-stone-600 rounded-full font-bold text-xs hover:bg-stone-50 transition-all"
        >
          Previous
        </button>
        <button 
          onClick={(e) => {
            e.stopPropagation();
            setIsFlipped(false);
            setCurrentIndex(prev => (prev === vocab.length - 1 ? 0 : prev + 1));
          }}
          className="flex-1 py-2.5 bg-stone-900 text-white rounded-full font-bold text-xs hover:bg-stone-800 transition-all shadow-sm shadow-stone-200"
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
  const { play, loading: ttsLoading } = useTTSContext();

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

const Settings = ({ vocab }: { vocab: Vocabulary[] }) => {
  const { profile, user, isDemo } = useContext(AuthContext);
  const { mode, setTTSMode } = useTTSContext();
  const [name, setName] = useState(profile?.displayName || '');
  const [dailyGoal, setDailyGoal] = useState(profile?.dailyGoal || 5);
  const [avatar, setAvatar] = useState(profile?.avatar || '🦊');
  const [notificationsEnabled, setNotificationsEnabled] = useState(profile?.notificationsEnabled ?? true);
  const [saving, setSaving] = useState(false);
  const hasApiKey = !!getApiKey();

  const avatars = ['🦊', '🐱', '🐶', '🐼', '🐨', '🦁', '🐯', '🐸', '🐵', '🦉'];

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const updates = { 
        displayName: name, 
        dailyGoal: Number(dailyGoal),
        avatar: avatar,
        notificationsEnabled: notificationsEnabled
      };
      if (isDemo) {
        const p = JSON.parse(localStorage.getItem('komorebi_profile') || '{}');
        localStorage.setItem('komorebi_profile', JSON.stringify({ ...p, ...updates }));
        window.location.reload();
      } else if (user) {
        await updateDoc(doc(db, 'users', user.uid), updates);
      }
    } finally {
      setSaving(false);
    }
  };

  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState<string | null>(null);

  const handleTestAI = async () => {
    setTestStatus('testing');
    setTestError(null);
    try {
      const ai = getAI();
      if (!ai) throw new Error("API Key is missing from the environment.");
      
      const response = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: "Respond with 'OK'",
      });
      
      if (response.text) {
        setTestStatus('success');
      } else {
        throw new Error("Received an empty response from the AI.");
      }
    } catch (error: any) {
      console.error("AI Test Error:", error);
      setTestStatus('error');
      setTestError(error.message || "An unknown error occurred.");
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-10 pb-12">
      <div>
        <h2 className="text-4xl font-editorial italic text-stone-900 mb-2">Settings</h2>
        <p className="text-stone-500 font-serif italic">Personalize your learning experience.</p>
      </div>

      <div className="bg-white rounded-[2.5rem] p-6 md:p-8 shadow-sm border border-stone-50 space-y-8">
        <section className="space-y-6">
          <h3 className="text-sm font-bold uppercase tracking-widest text-stone-400">Profile</h3>
          
          <div className="space-y-6">
            <div className="flex items-center gap-6 p-4 bg-stone-50 rounded-3xl">
              <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center text-4xl shadow-sm border border-stone-100">
                {avatar}
              </div>
              <div className="flex-1 space-y-1">
                <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Current Identity</div>
                <div className="text-xl font-editorial italic text-stone-900">{name || 'Learner'}</div>
                <div className="text-[10px] text-stone-400 font-serif italic">Level 12 · {vocab.length} words mastered</div>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-mono text-stone-400 uppercase tracking-widest">Choose Avatar</label>
              <div className="flex flex-wrap gap-2">
                {avatars.map(a => (
                  <button
                    key={a}
                    onClick={() => setAvatar(a)}
                    className={cn(
                      "w-10 h-10 flex items-center justify-center rounded-xl text-xl transition-all",
                      avatar === a ? "bg-stone-900 scale-110 shadow-lg" : "bg-stone-50 hover:bg-stone-100"
                    )}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <label className="text-xs font-mono text-stone-400 uppercase tracking-widest">Display Name</label>
                <input 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full p-4 bg-stone-50 rounded-2xl border-none focus:ring-2 focus:ring-stone-200 outline-none transition-all"
                  placeholder="Enter your name..."
                />
              </div>

              <div className="space-y-3">
                <label className="text-xs font-mono text-stone-400 uppercase tracking-widest">Email Address</label>
                <div className="w-full p-4 bg-stone-50 rounded-2xl text-stone-400 text-sm font-medium border border-stone-100/50">
                  {user?.email || 'Guest User'}
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-xs font-mono text-stone-400 uppercase tracking-widest">Daily Goal (Words)</label>
                <div className="flex gap-2">
                  {[3, 5, 10, 20].map(goal => (
                    <button
                      key={goal}
                      onClick={() => setDailyGoal(goal)}
                      className={cn(
                        "flex-1 py-3 rounded-xl font-bold text-xs transition-all",
                        dailyGoal === goal ? "bg-stone-900 text-white" : "bg-stone-50 text-stone-400 hover:bg-stone-100"
                      )}
                    >
                      {goal}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-xs font-mono text-stone-400 uppercase tracking-widest">Member Since</label>
                <div className="w-full p-4 bg-stone-50 rounded-2xl text-stone-400 text-sm font-medium border border-stone-100/50">
                  {user?.metadata.creationTime ? new Date(user.metadata.creationTime).toLocaleDateString() : 'Today (Guest)'}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-6 bg-stone-50 rounded-[2rem] border border-stone-100">
              <div className="space-y-1">
                <div className="text-sm font-bold text-stone-900">Streak Notifications</div>
                <div className="text-xs text-stone-500 font-serif italic">Get alerted 4 hours before your streak expires.</div>
              </div>
              <button 
                onClick={() => setNotificationsEnabled(!notificationsEnabled)}
                className={cn(
                  "w-12 h-6 rounded-full transition-all relative p-1",
                  notificationsEnabled ? "bg-stone-900" : "bg-stone-200"
                )}
              >
                <motion.div 
                  animate={{ x: notificationsEnabled ? 24 : 0 }}
                  className="w-4 h-4 bg-white rounded-full shadow-sm"
                />
              </button>
            </div>

            <div className="pt-4">
              <button 
                onClick={handleSaveProfile}
                disabled={saving || !name.trim()}
                className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold disabled:opacity-50 hover:bg-stone-800 transition-all shadow-xl shadow-stone-200 flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Saving...
                  </>
                ) : 'Save Profile Changes'}
              </button>
            </div>
          </div>
        </section>

        <div className="h-px bg-stone-50" />

        {user && !isDemo && (
          <>
            <section className="space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-widest text-stone-400">Account</h3>
              <div className="p-4 bg-stone-50 rounded-2xl flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Logged in as</div>
                  <div className="text-sm font-medium text-stone-900">{user.email}</div>
                </div>
                <div className="px-3 py-1 bg-white rounded-full border border-stone-100 text-[10px] font-bold text-stone-400 uppercase tracking-widest">
                  {user.providerData[0]?.providerId === 'google.com' ? 'Google' : 'Email'}
                </div>
              </div>
            </section>
            <div className="h-px bg-stone-50" />
          </>
        )}

        <section className="space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-widest text-stone-400">Voice Preferences</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button 
              onClick={() => setTTSMode('native')}
              className={cn(
                "p-6 rounded-3xl border-2 transition-all text-left space-y-2",
                mode === 'native' ? "border-stone-900 bg-stone-50" : "border-stone-50 hover:border-stone-200"
              )}
            >
              <div className="font-bold text-stone-900">Built-in Voice</div>
              <div className="text-xs text-stone-500 font-serif italic">Uses your device's native text-to-speech. Free and unlimited.</div>
            </button>
            <button 
              onClick={() => setTTSMode('gemini')}
              className={cn(
                "p-6 rounded-3xl border-2 transition-all text-left space-y-2",
                mode === 'gemini' ? "border-stone-900 bg-stone-50" : "border-stone-50 hover:border-stone-200"
              )}
            >
              <div className="font-bold text-stone-900">AI Voice (Gemini)</div>
              <div className="text-xs text-stone-500 font-serif italic">High-quality neural voices. Requires an API key and has daily limits.</div>
            </button>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-widest text-stone-400">System Diagnostics</h3>
          <div className="p-6 bg-stone-50 rounded-3xl space-y-4">
            <div className="flex justify-between items-center text-xs">
              <span className="text-stone-500 font-serif italic">AI Key Status</span>
              <span className={cn(
                "font-mono font-bold px-2 py-1 rounded-md",
                hasApiKey ? "text-emerald-600 bg-emerald-50" : "text-red-600 bg-red-50"
              )}>
                {hasApiKey ? `Detected (Ends in ...${getApiKey().slice(-4) || '****'})` : 'Missing'}
              </span>
            </div>
            
            <div className="pt-2">
              <div className="text-[10px] uppercase tracking-wider text-stone-400 font-bold mb-2">Manual Key Entry (Optional)</div>
              <div className="flex gap-2">
                <input 
                  type="password"
                  placeholder="Paste GEMINI_API_KEY here..."
                  className="flex-1 bg-white border border-stone-100 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-stone-200"
                  onBlur={(e) => {
                    if (e.target.value.trim()) {
                      localStorage.setItem('komorebi_gemini_key', e.target.value.trim());
                      window.location.reload();
                    }
                  }}
                />
                {localStorage.getItem('komorebi_gemini_key') && (
                  <button 
                    onClick={() => {
                      localStorage.removeItem('komorebi_gemini_key');
                      window.location.reload();
                    }}
                    className="px-3 py-2 bg-red-50 text-red-600 rounded-xl text-[10px] font-bold"
                  >
                    Clear
                  </button>
                )}
              </div>
              <p className="text-[10px] text-stone-400 mt-2 italic">Use this if the automatic detection fails in your browser.</p>
            </div>

            <div className="pt-2">
              <button 
                onClick={handleTestAI}
                disabled={testStatus === 'testing'}
                className={cn(
                  "w-full py-3 rounded-2xl text-xs font-bold transition-all border",
                  testStatus === 'idle' && "bg-white text-stone-900 border-stone-100 hover:bg-stone-50",
                  testStatus === 'testing' && "bg-stone-100 text-stone-400 border-stone-100 animate-pulse",
                  testStatus === 'success' && "bg-emerald-50 text-emerald-600 border-emerald-100",
                  testStatus === 'error' && "bg-red-50 text-red-600 border-red-100"
                )}
              >
                {testStatus === 'idle' && "Test AI Connection"}
                {testStatus === 'testing' && "Testing..."}
                {testStatus === 'success' && "✓ Connection Successful"}
                {testStatus === 'error' && "✕ Connection Failed"}
              </button>
              {testError && (
                <div className="mt-3 p-3 bg-red-50 text-[10px] text-red-700 font-mono rounded-xl border border-red-100 overflow-auto max-h-24">
                  {testError}
                </div>
              )}
            </div>

            <div className="flex justify-between items-center text-xs">
              <span className="text-stone-500 font-serif italic">Environment</span>
              <span className="font-mono text-stone-900 bg-white px-2 py-1 rounded-md border border-stone-100">
                {process.env.NODE_ENV || 'development'}
              </span>
            </div>
            {!hasApiKey && (
              <p className="text-[10px] text-amber-600 font-serif italic bg-amber-50 p-3 rounded-xl border border-amber-100">
                Tip: If you just added your key, you may need to "Share" or "Deploy" the app again to update the production build.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

const Chatbot = () => {
  const [messages, setMessages] = useState<{ role: 'user' | 'model'; text: string }[]>([
    { role: 'model', text: "Konnichiwa! I'm your Japanese culture and language assistant. Ask me anything about Japan, its people, or the language!" }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    if (!getApiKey()) {
      setMessages(prev => [...prev, { role: 'model', text: "I need an API key to work! Please add your `GEMINI_API_KEY` in the app settings (⚙️ icon -> Secrets)." }]);
      return;
    }

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setLoading(true);

    try {
      const ai = getAI();
      if (!ai) throw new Error("AI Key not found. Please add your API key in settings.");

      const chat = ai.chats.create({
        model: "gemini-flash-latest",
        config: {
          systemInstruction: "You are a helpful and knowledgeable assistant specializing in Japanese culture, people, and language. Your tone is polite, encouraging, and informative. You can provide cultural context, explain grammar points, and suggest travel tips. Keep responses concise and engaging.",
        },
      });

      const response = await chat.sendMessage({ message: userMsg });
      const modelText = response.text || "I'm sorry, I couldn't process that.";
      setMessages(prev => [...prev, { role: 'model', text: modelText }]);
    } catch (error: any) {
      console.error("Chat Error:", error);
      setMessages(prev => [...prev, { role: 'model', text: `Error: ${error.message || "Something went wrong."}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto h-[calc(100vh-12rem)] flex flex-col">
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <h2 className="text-4xl font-editorial italic text-stone-900 mb-2">Sensei Chat</h2>
        <p className="text-stone-500 font-serif italic">Talk about Japan, the language, and culture.</p>
      </motion.div>

      {!getApiKey() && (
        <div className="mb-6">
          <MissingApiKeyWarning />
        </div>
      )}

      <div className="flex-1 bg-white rounded-[3rem] border border-stone-100 shadow-xl overflow-hidden flex flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
          {messages.map((msg, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, x: msg.role === 'user' ? 20 : -20 }}
              animate={{ opacity: 1, x: 0 }}
              className={cn(
                "flex",
                msg.role === 'user' ? "justify-end" : "justify-start"
              )}
            >
              <div className={cn(
                "max-w-[80%] p-5 rounded-3xl text-sm leading-relaxed",
                msg.role === 'user' 
                  ? "bg-stone-900 text-white rounded-tr-none" 
                  : "bg-stone-50 text-stone-900 rounded-tl-none font-serif italic"
              )}>
                <ReactMarkdown>{msg.text}</ReactMarkdown>
              </div>
            </motion.div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-stone-50 p-5 rounded-3xl rounded-tl-none animate-pulse flex gap-2">
                <div className="w-2 h-2 bg-stone-300 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-stone-300 rounded-full animate-bounce [animation-delay:0.2s]" />
                <div className="w-2 h-2 bg-stone-300 rounded-full animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          )}
        </div>

        <motion.form 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleSend} 
          className="p-6 bg-stone-50 border-t border-stone-100 flex gap-4"
        >
          <input 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about Japan..."
            className="flex-1 p-4 bg-white border-none rounded-2xl focus:ring-2 focus:ring-stone-200 outline-none transition-all font-serif italic"
          />
          <button 
            type="submit"
            disabled={loading || !input.trim()}
            className="p-4 bg-stone-900 text-white rounded-2xl shadow-lg hover:bg-stone-800 transition-all disabled:opacity-50 hover:scale-110 active:scale-95"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </motion.form>
      </div>
    </div>
  );
};

const Notebook = () => {
  const { user, isDemo } = useContext(AuthContext);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');

  useEffect(() => {
    if (isDemo) {
      const localNotes = JSON.parse(localStorage.getItem('komorebi_notes') || '[]');
      setNotes(localNotes);
      setLoading(false);
      return;
    }

    if (!user) return;
    const notesRef = collection(db, 'users', user.uid, 'notes');
    const q = query(notesRef, orderBy('updatedAt', 'desc'));
    
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Note));
      setNotes(list);
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/notes`);
    });

    return () => unsub();
  }, [user, isDemo]);

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    const noteData = {
      title: newTitle,
      content: newContent,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      color: ['bg-blue-50', 'bg-emerald-50', 'bg-purple-50', 'bg-orange-50', 'bg-pink-50'][Math.floor(Math.random() * 5)]
    };

    if (isDemo) {
      const localNotes = JSON.parse(localStorage.getItem('komorebi_notes') || '[]');
      const updated = [{ id: Date.now().toString(), ...noteData }, ...localNotes];
      localStorage.setItem('komorebi_notes', JSON.stringify(updated));
      setNotes(updated as any);
    } else if (user) {
      await addDoc(collection(db, 'users', user.uid, 'notes'), noteData);
    }

    setNewTitle('');
    setNewContent('');
    setIsAdding(false);
  };

  const deleteNote = async (id: string) => {
    if (isDemo) {
      const localNotes = JSON.parse(localStorage.getItem('komorebi_notes') || '[]');
      const updated = localNotes.filter((n: any) => n.id !== id);
      localStorage.setItem('komorebi_notes', JSON.stringify(updated));
      setNotes(updated);
    } else if (user) {
      const { deleteDoc } = await import('firebase/firestore');
      await deleteDoc(doc(db, 'users', user.uid, 'notes', id));
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-4xl font-editorial italic text-stone-900 mb-2">Notebook</h2>
          <p className="text-stone-500 font-serif italic">Your personal space for Japanese study notes.</p>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="p-4 bg-stone-900 text-white rounded-2xl shadow-xl hover:bg-stone-800 transition-all"
        >
          <PlusCircle className="w-6 h-6" />
        </button>
      </div>

      {isAdding && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-8 rounded-[2.5rem] border border-stone-100 shadow-xl space-y-4"
        >
          <input 
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Note Title..."
            className="w-full p-4 bg-stone-50 border-none rounded-2xl font-bold text-xl outline-none focus:ring-2 focus:ring-stone-100"
          />
          <textarea 
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Write your notes here..."
            rows={5}
            className="w-full p-4 bg-stone-50 border-none rounded-2xl font-serif italic outline-none focus:ring-2 focus:ring-stone-100"
          />
          <div className="flex gap-4">
            <button 
              onClick={() => setIsAdding(false)}
              className="flex-1 py-4 bg-stone-50 text-stone-600 rounded-full font-bold"
            >
              Cancel
            </button>
            <button 
              onClick={handleAddNote}
              className="flex-1 py-4 bg-stone-900 text-white rounded-full font-bold shadow-lg"
            >
              Save Note
            </button>
          </div>
        </motion.div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <RotateCcw className="w-8 h-8 text-stone-200 animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {notes.length === 0 ? (
            <div className="col-span-full text-center py-20 bg-white rounded-[3rem] border border-stone-50">
              <p className="text-stone-400 font-editorial italic">Your notebook is empty. Start writing!</p>
            </div>
          ) : (
            notes.map((note) => (
              <motion.div 
                key={note.id}
                layout
                className={cn("p-8 rounded-[2.5rem] border border-stone-50 shadow-sm hover:shadow-md transition-all relative group", note.color || 'bg-white')}
              >
                <button 
                  onClick={() => note.id && deleteNote(note.id)}
                  className="absolute top-6 right-6 p-2 text-stone-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <h3 className="text-xl font-bold text-stone-900 mb-3">{note.title}</h3>
                <p className="text-stone-600 font-serif italic text-sm leading-relaxed whitespace-pre-wrap">{note.content}</p>
                <div className="mt-6 text-[8px] font-bold uppercase tracking-widest text-stone-400">
                  {format(note.updatedAt.toDate(), 'MMM d, yyyy')}
                </div>
              </motion.div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
const Games = ({ vocab, onSelectGame }: { vocab: Vocabulary[]; onSelectGame: (id: string) => void }) => {
  const [currentGame, setCurrentGame] = useState<string | null>(null);

  if (currentGame === 'typing') return <TypingGame vocab={vocab} onBack={() => setCurrentGame(null)} />;
  if (currentGame === 'match') return <KanaMatch onBack={() => setCurrentGame(null)} />;
  if (currentGame === 'scramble') return <WordScramble vocab={vocab} onBack={() => setCurrentGame(null)} />;
  if (currentGame === 'speed') return <SpeedQuiz vocab={vocab} onBack={() => setCurrentGame(null)} />;
  if (currentGame === 'listening') return <ListeningHero vocab={vocab} onBack={() => setCurrentGame(null)} />;
  if (currentGame === 'sprint') return <FlashcardSprint vocab={vocab} onBack={() => setCurrentGame(null)} />;
  if (currentGame === 'kanji') return <KanjiQuiz vocab={vocab} onBack={() => setCurrentGame(null)} />;
  if (currentGame === 'particle') return <ParticleMaster onBack={() => setCurrentGame(null)} />;
  if (currentGame === 'sentence') return <SentenceBuilder vocab={vocab} onBack={() => setCurrentGame(null)} />;
  if (currentGame === 'invaders') return <KanaInvaders onBack={() => setCurrentGame(null)} />;
  if (currentGame === 'wordsearch') return <WordSearch onBack={() => setCurrentGame(null)} />;

  const games = [
    { id: 'typing', title: 'Typing Game', description: 'Type the falling characters before they hit the ground.', icon: Gamepad2, color: 'bg-blue-500' },
    { id: 'match', title: 'Kana Match', description: 'Match Kana with their Romaji equivalents in this memory game.', icon: Layers, color: 'bg-emerald-500' },
    { id: 'scramble', title: 'Word Scramble', description: 'Unscramble Japanese words to test your spelling.', icon: RefreshCw, color: 'bg-purple-500' },
    { id: 'speed', title: 'Speed Quiz', description: 'How many words can you translate in 60 seconds?', icon: Timer, color: 'bg-orange-500' },
    { id: 'listening', title: 'Listening Hero', description: 'Listen to the audio and pick the correct word.', icon: Ear, color: 'bg-pink-500' },
    { id: 'sprint', title: 'Flashcard Sprint', description: 'Rapid-fire flashcard review to build muscle memory.', icon: Zap, color: 'bg-yellow-500' },
    { id: 'kanji', title: 'Kanji Quiz', description: 'Match the Kanji to its meaning.', icon: Book, color: 'bg-red-500' },
    { id: 'particle', title: 'Particle Master', description: 'Choose the correct particle for the sentence.', icon: List, color: 'bg-cyan-500' },
    { id: 'sentence', title: 'Sentence Builder', description: 'Arrange the words to form the correct sentence.', icon: Pencil, color: 'bg-indigo-500' },
    { id: 'invaders', title: 'Kana Invaders', description: 'Type the romaji for the falling kana before they reach the bottom.', icon: Gamepad2, color: 'bg-stone-900' },
    { id: 'wordsearch', title: 'Word Search', description: 'Find the Japanese words hidden in the grid.', icon: Search, color: 'bg-emerald-600' },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h2 className="text-4xl font-editorial italic text-stone-900">Arcade</h2>
        <p className="text-stone-500 font-serif italic">Fun ways to reinforce your Japanese skills.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {games.map((game) => (
          <motion.button
            key={game.id}
            whileHover={{ y: -5, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setCurrentGame(game.id)}
            className="flex flex-col text-left bg-white p-8 rounded-[2.5rem] shadow-xl shadow-stone-200/50 border border-stone-100 group transition-all"
          >
            <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center text-white mb-6 shadow-lg", game.color)}>
              <game.icon className="w-7 h-7" />
            </div>
            <h3 className="text-xl font-bold text-stone-900 mb-2 group-hover:text-stone-700 transition-colors">{game.title}</h3>
            <p className="text-stone-500 text-sm leading-relaxed">{game.description}</p>
            <div className="mt-6 flex items-center gap-2 text-stone-900 font-bold text-xs uppercase tracking-widest">
              Play Now <ChevronRight className="w-3 h-3" />
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
};

const KanaMatch = ({ onBack }: { onBack: () => void }) => {
  const [cards, setCards] = useState<{ id: number; content: string; type: 'kana' | 'romaji'; matched: boolean; flipped: boolean; pairId: number }[]>([]);
  const [flipped, setFlipped] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [matches, setMatches] = useState(0);
  const [gameOver, setGameOver] = useState(false);

  const initGame = useCallback(() => {
    const pool = hiragana.concat(katakana);
    const selected = [];
    const usedIndices = new Set();
    while (selected.length < 8) {
      const idx = Math.floor(Math.random() * pool.length);
      if (!usedIndices.has(idx)) {
        selected.push(pool[idx]);
        usedIndices.add(idx);
      }
    }

    const gameCards: any[] = [];
    selected.forEach((item, idx) => {
      gameCards.push({ id: idx * 2, content: item.kana, type: 'kana', matched: false, flipped: false, pairId: idx });
      gameCards.push({ id: idx * 2 + 1, content: item.romaji, type: 'romaji', matched: false, flipped: false, pairId: idx });
    });

    setCards(gameCards.sort(() => Math.random() - 0.5));
    setFlipped([]);
    setMoves(0);
    setMatches(0);
    setGameOver(false);
  }, []);

  useEffect(() => {
    initGame();
  }, [initGame]);

  const handleFlip = (id: number) => {
    if (flipped.length === 2 || cards.find(c => c.id === id)?.flipped || cards.find(c => c.id === id)?.matched) return;

    const newFlipped = [...flipped, id];
    setFlipped(newFlipped);
    setCards(prev => prev.map(c => c.id === id ? { ...c, flipped: true } : c));

    if (newFlipped.length === 2) {
      setMoves(prev => prev + 1);
      const [id1, id2] = newFlipped;
      const card1 = cards.find(c => c.id === id1)!;
      const card2 = cards.find(c => c.id === id2)!;

      if (card1.pairId === card2.pairId) {
        setTimeout(() => {
          setCards(prev => prev.map(c => (c.id === id1 || c.id === id2) ? { ...c, matched: true } : c));
          setFlipped([]);
          setMatches(prev => {
            const next = prev + 1;
            if (next === 8) setGameOver(true);
            return next;
          });
        }, 500);
      } else {
        setTimeout(() => {
          setCards(prev => prev.map(c => (c.id === id1 || c.id === id2) ? { ...c, flipped: false } : c));
          setFlipped([]);
        }, 1000);
      }
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="w-10 h-10 bg-white border border-stone-100 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-900 shadow-sm"><ChevronLeft className="w-5 h-5" /></button>
          <div>
            <h2 className="text-2xl font-editorial italic text-stone-900">Kana Match</h2>
            <p className="text-stone-500 font-serif italic text-xs">Match the Kana with its Romaji.</p>
          </div>
        </div>
        <div className="flex gap-6">
          <div className="text-right">
            <div className="text-[8px] font-bold uppercase tracking-widest text-stone-400">Moves</div>
            <div className="text-2xl font-editorial italic text-stone-900">{moves}</div>
          </div>
          <div className="text-right">
            <div className="text-[8px] font-bold uppercase tracking-widest text-stone-400">Matches</div>
            <div className="text-2xl font-editorial italic text-stone-900">{matches}/8</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {cards.map(card => (
          <motion.button
            key={card.id}
            whileHover={!card.matched && !card.flipped ? { scale: 1.05 } : {}}
            whileTap={!card.matched && !card.flipped ? { scale: 0.95 } : {}}
            onClick={() => handleFlip(card.id)}
            className={cn(
              "aspect-square rounded-3xl flex items-center justify-center text-3xl font-bold transition-all duration-500 preserve-3d relative shadow-lg",
              card.flipped || card.matched ? "bg-white text-stone-900 rotate-y-180" : "bg-stone-900 text-white"
            )}
          >
            {(card.flipped || card.matched) ? card.content : '?'}
          </motion.button>
        ))}
      </div>

      {gameOver && (
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-stone-900 text-white p-10 rounded-[3rem] text-center shadow-2xl">
          <Trophy className="w-16 h-16 text-yellow-400 mx-auto mb-4" />
          <h3 className="text-3xl font-editorial italic mb-2">Well Done!</h3>
          <p className="text-stone-400 mb-8">You finished in {moves} moves.</p>
          <button onClick={initGame} className="px-10 py-4 bg-white text-stone-900 rounded-full font-bold hover:bg-stone-50 transition-all">Play Again</button>
        </motion.div>
      )}
    </div>
  );
};

const WordScramble = ({ vocab, onBack }: { vocab: Vocabulary[]; onBack: () => void }) => {
  const [currentWord, setCurrentWord] = useState<Vocabulary | null>(null);
  const [scrambled, setScrambled] = useState('');
  const [input, setInput] = useState('');
  const [score, setScore] = useState(0);
  const [message, setMessage] = useState('');

  const nextWord = useCallback(() => {
    if (vocab.length === 0) return;
    const word = vocab[Math.floor(Math.random() * vocab.length)];
    setCurrentWord(word);
    const chars = word.japanese.split('');
    for (let i = chars.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    setScrambled(chars.join(''));
    setInput('');
    setMessage('');
  }, [vocab]);

  useEffect(() => {
    nextWord();
  }, [nextWord]);

  const checkAnswer = (e: React.FormEvent) => {
    e.preventDefault();
    if (input === currentWord?.japanese) {
      setScore(prev => prev + 10);
      setMessage('Correct! ✨');
      setTimeout(nextWord, 1000);
    } else {
      setMessage('Try again! ❌');
    }
  };

  if (vocab.length < 3) {
    return (
      <div className="text-center p-20 bg-white rounded-[3rem] border border-stone-100 shadow-xl">
        <h3 className="text-2xl font-editorial italic text-stone-900 mb-4">Not enough words</h3>
        <p className="text-stone-500 mb-8">Add at least 3 words to your vocabulary to play Word Scramble.</p>
        <button onClick={onBack} className="px-8 py-3 bg-stone-900 text-white rounded-full font-bold">Go Back</button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="w-10 h-10 bg-white border border-stone-100 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-900 shadow-sm"><ChevronLeft className="w-5 h-5" /></button>
          <div>
            <h2 className="text-2xl font-editorial italic text-stone-900">Word Scramble</h2>
            <p className="text-stone-500 font-serif italic text-xs">Unscramble the Japanese word.</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[8px] font-bold uppercase tracking-widest text-stone-400">Score</div>
          <div className="text-2xl font-editorial italic text-stone-900">{score}</div>
        </div>
      </div>

      <div className="bg-white p-12 rounded-[3rem] border border-stone-100 shadow-xl text-center space-y-8">
        <div className="text-5xl font-bold tracking-widest text-stone-900 bg-stone-50 py-10 rounded-3xl">{scrambled}</div>
        <p className="text-stone-400 font-serif italic">Meaning: {currentWord?.meaning}</p>
        
        <form onSubmit={checkAnswer} className="space-y-4">
          <input 
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type the correct word..."
            className="w-full p-5 bg-stone-50 border-none rounded-2xl text-center text-2xl font-medium focus:ring-2 focus:ring-stone-200 outline-none"
          />
          <button type="submit" className="w-full py-5 bg-stone-900 text-white rounded-full font-bold hover:bg-stone-800 transition-all shadow-xl shadow-stone-100">Check Answer</button>
        </form>
        {message && <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn("font-bold", message.includes('Correct') ? "text-emerald-500" : "text-red-500")}>{message}</motion.p>}
      </div>
    </div>
  );
};

const SpeedQuiz = ({ vocab, onBack }: { vocab: Vocabulary[]; onBack: () => void }) => {
  const [currentQuestion, setCurrentQuestion] = useState<{ word: Vocabulary; options: string[] } | null>(null);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [gameState, setGameState] = useState<'start' | 'playing' | 'end'>('start');

  const generateQuestion = useCallback(() => {
    if (vocab.length < 4) return;
    const word = vocab[Math.floor(Math.random() * vocab.length)];
    const options = [word.meaning];
    while (options.length < 4) {
      const randomWord = vocab[Math.floor(Math.random() * vocab.length)].meaning;
      if (!options.includes(randomWord)) options.push(randomWord);
    }
    setCurrentQuestion({ word, options: options.sort(() => Math.random() - 0.5) });
  }, [vocab]);

  useEffect(() => {
    if (gameState === 'playing' && timeLeft > 0) {
      const timer = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
      return () => clearInterval(timer);
    } else if (timeLeft === 0) {
      setGameState('end');
    }
  }, [gameState, timeLeft]);

  const startGame = () => {
    setScore(0);
    setTimeLeft(60);
    setGameState('playing');
    generateQuestion();
  };

  const handleAnswer = (option: string) => {
    if (option === currentQuestion?.word.meaning) {
      setScore(prev => prev + 10);
    }
    generateQuestion();
  };

  if (vocab.length < 4) {
    return (
      <div className="text-center p-20 bg-white rounded-[3rem] border border-stone-100 shadow-xl">
        <h3 className="text-2xl font-editorial italic text-stone-900 mb-4">Not enough words</h3>
        <p className="text-stone-500 mb-8">Add at least 4 words to your vocabulary to play Speed Quiz.</p>
        <button onClick={onBack} className="px-8 py-3 bg-stone-900 text-white rounded-full font-bold">Go Back</button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="w-10 h-10 bg-white border border-stone-100 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-900 shadow-sm"><ChevronLeft className="w-5 h-5" /></button>
          <div>
            <h2 className="text-2xl font-editorial italic text-stone-900">Speed Quiz</h2>
            <p className="text-stone-500 font-serif italic text-xs">How many can you get in 60 seconds?</p>
          </div>
        </div>
        <div className="flex gap-6">
          <div className="text-right">
            <div className="text-[8px] font-bold uppercase tracking-widest text-stone-400">Time</div>
            <div className={cn("text-2xl font-editorial italic", timeLeft < 10 ? "text-red-500" : "text-stone-900")}>{timeLeft}s</div>
          </div>
          <div className="text-right">
            <div className="text-[8px] font-bold uppercase tracking-widest text-stone-400">Score</div>
            <div className="text-2xl font-editorial italic text-stone-900">{score}</div>
          </div>
        </div>
      </div>

      {gameState === 'start' ? (
        <div className="bg-white p-12 rounded-[3rem] border border-stone-100 shadow-xl text-center">
          <Timer className="w-16 h-16 text-stone-900 mx-auto mb-6" />
          <h3 className="text-3xl font-editorial italic mb-4">Are you ready?</h3>
          <p className="text-stone-500 mb-8">You have 60 seconds to translate as many words as possible.</p>
          <button onClick={startGame} className="px-12 py-5 bg-stone-900 text-white rounded-full font-bold hover:bg-stone-800 transition-all shadow-xl shadow-stone-100">Start Quiz</button>
        </div>
      ) : gameState === 'playing' ? (
        <div className="bg-white p-12 rounded-[3rem] border border-stone-100 shadow-xl text-center space-y-10">
          <div className="text-6xl font-bold text-stone-900">{currentQuestion?.word.japanese}</div>
          <div className="grid grid-cols-2 gap-4">
            {currentQuestion?.options.map((option, i) => (
              <button key={i} onClick={() => handleAnswer(option)} className="p-6 bg-stone-50 hover:bg-stone-900 hover:text-white rounded-2xl font-medium transition-all text-lg">{option}</button>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-stone-900 text-white p-12 rounded-[3rem] text-center shadow-2xl">
          <Trophy className="w-16 h-16 text-yellow-400 mx-auto mb-4" />
          <h3 className="text-3xl font-editorial italic mb-2">Time's Up!</h3>
          <p className="text-stone-400 mb-8">Final Score: {score}</p>
          <button onClick={startGame} className="px-12 py-5 bg-white text-stone-900 rounded-full font-bold hover:bg-stone-50 transition-all">Try Again</button>
        </div>
      )}
    </div>
  );
};

const ListeningHero = ({ vocab, onBack }: { vocab: Vocabulary[]; onBack: () => void }) => {
  const { play } = useTTSContext();
  const [currentQuestion, setCurrentQuestion] = useState<{ word: Vocabulary; options: string[] } | null>(null);
  const [score, setScore] = useState(0);
  const [message, setMessage] = useState('');

  const generateQuestion = useCallback(() => {
    if (vocab.length < 4) return;
    const word = vocab[Math.floor(Math.random() * vocab.length)];
    const options = [word.japanese];
    while (options.length < 4) {
      const randomWord = vocab[Math.floor(Math.random() * vocab.length)].japanese;
      if (!options.includes(randomWord)) options.push(randomWord);
    }
    setCurrentQuestion({ word, options: options.sort(() => Math.random() - 0.5) });
    setMessage('');
  }, [vocab]);

  useEffect(() => {
    generateQuestion();
  }, [generateQuestion]);

  const handleAnswer = (option: string) => {
    if (option === currentQuestion?.word.japanese) {
      setScore(prev => prev + 10);
      setMessage('Correct! ✨');
      setTimeout(generateQuestion, 1000);
    } else {
      setMessage('Try again! ❌');
    }
  };

  if (vocab.length < 4) {
    return (
      <div className="text-center p-20 bg-white rounded-[3rem] border border-stone-100 shadow-xl">
        <h3 className="text-2xl font-editorial italic text-stone-900 mb-4">Not enough words</h3>
        <p className="text-stone-500 mb-8">Add at least 4 words to your vocabulary to play Listening Hero.</p>
        <button onClick={onBack} className="px-8 py-3 bg-stone-900 text-white rounded-full font-bold">Go Back</button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="w-10 h-10 bg-white border border-stone-100 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-900 shadow-sm"><ChevronLeft className="w-5 h-5" /></button>
          <div>
            <h2 className="text-2xl font-editorial italic text-stone-900">Listening Hero</h2>
            <p className="text-stone-500 font-serif italic text-xs">Listen and pick the correct word.</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[8px] font-bold uppercase tracking-widest text-stone-400">Score</div>
          <div className="text-2xl font-editorial italic text-stone-900">{score}</div>
        </div>
      </div>

      <div className="bg-white p-12 rounded-[3rem] border border-stone-100 shadow-xl text-center space-y-10">
        <button 
          onClick={() => currentQuestion && play(currentQuestion.word.japanese)}
          className="w-32 h-32 bg-stone-900 text-white rounded-full flex items-center justify-center mx-auto shadow-2xl hover:scale-105 transition-all active:scale-95 group"
        >
          <Volume2 className="w-12 h-12 group-hover:animate-pulse" />
        </button>
        <p className="text-stone-400 font-serif italic">Meaning: {currentQuestion?.word.meaning}</p>
        
        <div className="grid grid-cols-2 gap-4">
          {currentQuestion?.options.map((option, i) => (
            <button key={i} onClick={() => handleAnswer(option)} className="p-6 bg-stone-50 hover:bg-stone-900 hover:text-white rounded-2xl font-bold transition-all text-2xl">{option}</button>
          ))}
        </div>
        {message && <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn("font-bold", message.includes('Correct') ? "text-emerald-500" : "text-red-500")}>{message}</motion.p>}
      </div>
    </div>
  );
};

const FlashcardSprint = ({ vocab, onBack }: { vocab: Vocabulary[]; onBack: () => void }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [gameState, setGameState] = useState<'start' | 'playing' | 'end'>('start');

  const shuffledVocab = useRef<Vocabulary[]>([]);

  useEffect(() => {
    if (gameState === 'playing' && timeLeft > 0) {
      const timer = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
      return () => clearInterval(timer);
    } else if (timeLeft === 0) {
      setGameState('end');
    }
  }, [gameState, timeLeft]);

  const startGame = () => {
    shuffledVocab.current = [...vocab].sort(() => Math.random() - 0.5);
    setCurrentIndex(0);
    setShowAnswer(false);
    setScore(0);
    setTimeLeft(60);
    setGameState('playing');
  };

  const handleNext = (correct: boolean) => {
    if (correct) setScore(prev => prev + 1);
    setShowAnswer(false);
    setCurrentIndex(prev => (prev + 1) % shuffledVocab.current.length);
  };

  if (vocab.length < 1) {
    return (
      <div className="text-center p-20 bg-white rounded-[3rem] border border-stone-100 shadow-xl">
        <h3 className="text-2xl font-editorial italic text-stone-900 mb-4">No words found</h3>
        <p className="text-stone-500 mb-8">Add some words to your vocabulary to play Flashcard Sprint.</p>
        <button onClick={onBack} className="px-8 py-3 bg-stone-900 text-white rounded-full font-bold">Go Back</button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="w-10 h-10 bg-white border border-stone-100 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-900 shadow-sm"><ChevronLeft className="w-5 h-5" /></button>
          <div>
            <h2 className="text-2xl font-editorial italic text-stone-900">Flashcard Sprint</h2>
            <p className="text-stone-500 font-serif italic text-xs">Rapid fire review. Speed is key!</p>
          </div>
        </div>
        <div className="flex gap-6">
          <div className="text-right">
            <div className="text-[8px] font-bold uppercase tracking-widest text-stone-400">Time</div>
            <div className={cn("text-2xl font-editorial italic", timeLeft < 10 ? "text-red-500" : "text-stone-900")}>{timeLeft}s</div>
          </div>
          <div className="text-right">
            <div className="text-[8px] font-bold uppercase tracking-widest text-stone-400">Words</div>
            <div className="text-2xl font-editorial italic text-stone-900">{score}</div>
          </div>
        </div>
      </div>

      {gameState === 'start' ? (
        <div className="bg-white p-12 rounded-[3rem] border border-stone-100 shadow-xl text-center">
          <Zap className="w-16 h-16 text-stone-900 mx-auto mb-6" />
          <h3 className="text-3xl font-editorial italic mb-4">Sprint Mode</h3>
          <p className="text-stone-500 mb-8">Review as many cards as you can in 60 seconds.</p>
          <button onClick={startGame} className="px-12 py-5 bg-stone-900 text-white rounded-full font-bold hover:bg-stone-800 transition-all shadow-xl shadow-stone-100">Start Sprint</button>
        </div>
      ) : gameState === 'playing' ? (
        <div className="space-y-8">
          <motion.div 
            key={currentIndex}
            initial={{ x: 50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="bg-white aspect-video rounded-[3rem] border border-stone-100 shadow-xl flex flex-col items-center justify-center p-12 text-center relative overflow-hidden"
          >
            <div className="text-6xl font-bold text-stone-900 mb-4">{shuffledVocab.current[currentIndex].japanese}</div>
            <AnimatePresence>
              {showAnswer && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
                  <div className="text-2xl text-stone-500 font-serif italic">{shuffledVocab.current[currentIndex].romaji}</div>
                  <div className="text-3xl font-bold text-stone-900">{shuffledVocab.current[currentIndex].meaning}</div>
                </motion.div>
              )}
            </AnimatePresence>
            {!showAnswer && (
              <button onClick={() => setShowAnswer(true)} className="mt-8 text-stone-400 font-bold text-xs uppercase tracking-widest hover:text-stone-900 transition-colors">Show Answer</button>
            )}
          </motion.div>

          <div className="grid grid-cols-2 gap-4">
            <button 
              disabled={!showAnswer}
              onClick={() => handleNext(false)} 
              className="py-5 bg-stone-100 text-stone-500 rounded-2xl font-bold hover:bg-stone-200 transition-all disabled:opacity-50"
            >
              Skip
            </button>
            <button 
              disabled={!showAnswer}
              onClick={() => handleNext(true)} 
              className="py-5 bg-stone-900 text-white rounded-2xl font-bold hover:bg-stone-800 transition-all disabled:opacity-50"
            >
              I Knew It
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-stone-900 text-white p-12 rounded-[3rem] text-center shadow-2xl">
          <Trophy className="w-16 h-16 text-yellow-400 mx-auto mb-4" />
          <h3 className="text-3xl font-editorial italic mb-2">Sprint Finished!</h3>
          <p className="text-stone-400 mb-8">You mastered {score} words in 60 seconds.</p>
          <button onClick={startGame} className="px-12 py-5 bg-white text-stone-900 rounded-full font-bold hover:bg-stone-50 transition-all">Start New Sprint</button>
        </div>
      )}
    </div>
  );
};

const KanjiQuiz = ({ vocab, onBack }: { vocab: Vocabulary[]; onBack: () => void }) => {
  const [currentQuestion, setCurrentQuestion] = useState<{ word: Vocabulary; options: string[] } | null>(null);
  const [score, setScore] = useState(0);
  const [message, setMessage] = useState('');

  const generateQuestion = useCallback(() => {
    const kanjiWords = vocab.filter(v => /[\u4e00-\u9faf]/.test(v.japanese));
    if (kanjiWords.length < 4) return;
    
    const word = kanjiWords[Math.floor(Math.random() * kanjiWords.length)];
    const options = [word.meaning];
    while (options.length < 4) {
      const randomWord = vocab[Math.floor(Math.random() * vocab.length)].meaning;
      if (!options.includes(randomWord)) options.push(randomWord);
    }
    setCurrentQuestion({ word, options: options.sort(() => Math.random() - 0.5) });
    setMessage('');
  }, [vocab]);

  useEffect(() => {
    generateQuestion();
  }, [generateQuestion]);

  const handleAnswer = (option: string) => {
    if (option === currentQuestion?.word.meaning) {
      setScore(prev => prev + 10);
      setMessage('Correct! ✨');
      setTimeout(generateQuestion, 1000);
    } else {
      setMessage('Try again! ❌');
    }
  };

  if (vocab.filter(v => /[\u4e00-\u9faf]/.test(v.japanese)).length < 4) {
    return (
      <div className="text-center p-20 bg-white rounded-[3rem] border border-stone-100 shadow-xl">
        <h3 className="text-2xl font-editorial italic text-stone-900 mb-4">Not enough Kanji</h3>
        <p className="text-stone-500 mb-8">Add at least 4 words containing Kanji to your vocabulary to play Kanji Quiz.</p>
        <button onClick={onBack} className="px-8 py-3 bg-stone-900 text-white rounded-full font-bold">Go Back</button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="w-10 h-10 bg-white border border-stone-100 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-900 shadow-sm"><ChevronLeft className="w-5 h-5" /></button>
          <div>
            <h2 className="text-2xl font-editorial italic text-stone-900">Kanji Quiz</h2>
            <p className="text-stone-500 font-serif italic text-xs">Match the Kanji to its meaning.</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[8px] font-bold uppercase tracking-widest text-stone-400">Score</div>
          <div className="text-2xl font-editorial italic text-stone-900">{score}</div>
        </div>
      </div>

      <div className="bg-white p-12 rounded-[3rem] border border-stone-100 shadow-xl text-center space-y-10">
        <div className="text-8xl font-bold text-stone-900">{currentQuestion?.word.japanese}</div>
        <div className="grid grid-cols-2 gap-4">
          {currentQuestion?.options.map((option, i) => (
            <button key={i} onClick={() => handleAnswer(option)} className="p-6 bg-stone-50 hover:bg-stone-900 hover:text-white rounded-2xl font-bold transition-all text-xl">{option}</button>
          ))}
        </div>
        {message && <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn("font-bold", message.includes('Correct') ? "text-emerald-500" : "text-red-500")}>{message}</motion.p>}
      </div>
    </div>
  );
};

const ParticleMaster = ({ onBack }: { onBack: () => void }) => {
  const [score, setScore] = useState(0);
  const [message, setMessage] = useState('');
  const [currentQuestion, setCurrentQuestion] = useState<{ sentence: string; answer: string; options: string[] } | null>(null);

  const questions = [
    { sentence: "私は学生___です。", answer: "は", options: ["は", "が", "を", "に"] },
    { sentence: "りんご___食べます。", answer: "を", options: ["を", "は", "が", "も"] },
    { sentence: "学校___行きます。", answer: "に", options: ["に", "で", "を", "は"] },
    { sentence: "公園___遊びます。", answer: "で", options: ["で", "に", "を", "へ"] },
    { sentence: "これ___私の本です。", answer: "は", options: ["は", "が", "の", "と"] },
    { sentence: "田中さん___会いました。", answer: "に", options: ["に", "と", "を", "で"] },
    { sentence: "日本語___勉強します。", answer: "を", options: ["を", "が", "は", "に"] },
    { sentence: "猫___好きです。", answer: "が", options: ["が", "は", "を", "に"] },
  ];

  const generateQuestion = useCallback(() => {
    const q = questions[Math.floor(Math.random() * questions.length)];
    setCurrentQuestion(q);
    setMessage('');
  }, []);

  useEffect(() => {
    generateQuestion();
  }, [generateQuestion]);

  const handleAnswer = (option: string) => {
    if (option === currentQuestion?.answer) {
      setScore(prev => prev + 10);
      setMessage('Correct! ✨');
      setTimeout(generateQuestion, 1000);
    } else {
      setMessage('Try again! ❌');
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="w-10 h-10 bg-white border border-stone-100 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-900 shadow-sm"><ChevronLeft className="w-5 h-5" /></button>
          <div>
            <h2 className="text-2xl font-editorial italic text-stone-900">Particle Master</h2>
            <p className="text-stone-500 font-serif italic text-xs">Choose the correct particle for the sentence.</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[8px] font-bold uppercase tracking-widest text-stone-400">Score</div>
          <div className="text-2xl font-editorial italic text-stone-900">{score}</div>
        </div>
      </div>

      <div className="bg-white p-12 rounded-[3rem] border border-stone-100 shadow-xl text-center space-y-10">
        <div className="text-4xl font-bold text-stone-900 leading-relaxed">{currentQuestion?.sentence}</div>
        <div className="grid grid-cols-2 gap-4">
          {currentQuestion?.options.map((option, i) => (
            <button key={i} onClick={() => handleAnswer(option)} className="p-6 bg-stone-50 hover:bg-stone-900 hover:text-white rounded-2xl font-bold transition-all text-2xl">{option}</button>
          ))}
        </div>
        {message && <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn("font-bold", message.includes('Correct') ? "text-emerald-500" : "text-red-500")}>{message}</motion.p>}
      </div>
    </div>
  );
};

const SentenceBuilder = ({ vocab, onBack }: { vocab: Vocabulary[]; onBack: () => void }) => {
  const [score, setScore] = useState(0);
  const [message, setMessage] = useState('');
  const [currentQuestion, setCurrentQuestion] = useState<{ sentence: string; words: string[]; answer: string[] } | null>(null);
  const [userAnswer, setUserAnswer] = useState<string[]>([]);

  const sentences = [
    { sentence: "I eat an apple.", answer: ["私", "は", "りんご", "を", "食べます"], words: ["私", "は", "りんご", "を", "食べます"].sort(() => Math.random() - 0.5) },
    { sentence: "I go to school.", answer: ["私", "は", "学校", "に", "行きます"], words: ["私", "は", "学校", "に", "行きます"].sort(() => Math.random() - 0.5) },
    { sentence: "This is my book.", answer: ["これ", "は", "私", "の", "本", "です"], words: ["これ", "は", "私", "の", "本", "です"].sort(() => Math.random() - 0.5) },
    { sentence: "I like cats.", answer: ["私", "は", "猫", "が", "好き", "です"], words: ["私", "は", "猫", "が", "好き", "です"].sort(() => Math.random() - 0.5) },
  ];

  const generateQuestion = useCallback(() => {
    const q = sentences[Math.floor(Math.random() * sentences.length)];
    setCurrentQuestion({ ...q, words: [...q.words] });
    setUserAnswer([]);
    setMessage('');
  }, []);

  useEffect(() => {
    generateQuestion();
  }, [generateQuestion]);

  const addWord = (word: string, index: number) => {
    setUserAnswer([...userAnswer, word]);
    const newWords = [...currentQuestion!.words];
    newWords.splice(index, 1);
    setCurrentQuestion({ ...currentQuestion!, words: newWords });
  };

  const removeWord = (word: string, index: number) => {
    const newUserAnswer = [...userAnswer];
    newUserAnswer.splice(index, 1);
    setUserAnswer(newUserAnswer);
    setCurrentQuestion({ ...currentQuestion!, words: [...currentQuestion!.words, word] });
  };

  const checkAnswer = () => {
    if (userAnswer.join('') === currentQuestion?.answer.join('')) {
      setScore(prev => prev + 20);
      setMessage('Correct! ✨');
      setTimeout(generateQuestion, 1500);
    } else {
      setMessage('Try again! ❌');
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="w-10 h-10 bg-white border border-stone-100 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-900 shadow-sm"><ChevronLeft className="w-5 h-5" /></button>
          <div>
            <h2 className="text-2xl font-editorial italic text-stone-900">Sentence Builder</h2>
            <p className="text-stone-500 font-serif italic text-xs">Arrange the words to form the correct sentence.</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[8px] font-bold uppercase tracking-widest text-stone-400">Score</div>
          <div className="text-2xl font-editorial italic text-stone-900">{score}</div>
        </div>
      </div>

      <div className="bg-white p-12 rounded-[3rem] border border-stone-100 shadow-xl text-center space-y-10">
        <div className="text-xl font-serif italic text-stone-500">"{currentQuestion?.sentence}"</div>
        
        <div className="min-h-[100px] p-6 bg-stone-50 rounded-3xl flex flex-wrap gap-3 items-center justify-center border-2 border-dashed border-stone-200">
          {userAnswer.map((word, i) => (
            <button key={i} onClick={() => removeWord(word, i)} className="px-6 py-3 bg-stone-900 text-white rounded-xl font-bold hover:bg-stone-800 transition-all">{word}</button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 justify-center">
          {currentQuestion?.words.map((word, i) => (
            <button key={i} onClick={() => addWord(word, i)} className="px-6 py-3 bg-white border border-stone-200 text-stone-900 rounded-xl font-bold hover:bg-stone-50 transition-all">{word}</button>
          ))}
        </div>

        <div className="pt-4">
          <button onClick={checkAnswer} className="w-full py-5 bg-stone-900 text-white rounded-full font-bold hover:bg-stone-800 transition-all shadow-xl shadow-stone-100">Check Sentence</button>
        </div>
        
        {message && <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn("font-bold", message.includes('Correct') ? "text-emerald-500" : "text-red-500")}>{message}</motion.p>}
      </div>
    </div>
  );
};

const WordSearch = ({ onBack }: { onBack: () => void }) => {
  const [grid, setGrid] = useState<string[][]>([]);
  const [words, setWords] = useState<{ word: string; found: boolean }[]>([]);
  const [selection, setSelection] = useState<{ r: number; c: number }[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const [score, setScore] = useState(0);
  const [gameActive, setGameActive] = useState(false);
  const gridSize = 10;

  const generateGrid = () => {
    const newGrid = Array(gridSize).fill(null).map(() => Array(gridSize).fill(''));
    const targetWords = [
      { jp: 'ねこ', en: 'Cat' },
      { jp: 'いぬ', en: 'Dog' },
      { jp: 'さかな', en: 'Fish' },
      { jp: 'とり', en: 'Bird' },
      { jp: 'はな', en: 'Flower' },
      { jp: 'みず', en: 'Water' },
      { jp: 'やま', en: 'Mountain' },
      { jp: 'そら', en: 'Sky' },
    ].sort(() => Math.random() - 0.5).slice(0, 5);

    setWords(targetWords.map(w => ({ word: w.jp, found: false })));

    targetWords.forEach(({ jp }) => {
      let placed = false;
      while (!placed) {
        const direction = Math.random() > 0.5 ? 'H' : 'V';
        const r = Math.floor(Math.random() * gridSize);
        const c = Math.floor(Math.random() * gridSize);

        if (direction === 'H' && c + jp.length <= gridSize) {
          let canPlace = true;
          for (let i = 0; i < jp.length; i++) {
            if (newGrid[r][c + i] !== '' && newGrid[r][c + i] !== jp[i]) canPlace = false;
          }
          if (canPlace) {
            for (let i = 0; i < jp.length; i++) newGrid[r][c + i] = jp[i];
            placed = true;
          }
        } else if (direction === 'V' && r + jp.length <= gridSize) {
          let canPlace = true;
          for (let i = 0; i < jp.length; i++) {
            if (newGrid[r + i][c] !== '' && newGrid[r + i][c] !== jp[i]) canPlace = false;
          }
          if (canPlace) {
            for (let i = 0; i < jp.length; i++) newGrid[r + i][c] = jp[i];
            placed = true;
          }
        }
      }
    });

    const kana = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        if (newGrid[r][c] === '') newGrid[r][c] = kana[Math.floor(Math.random() * kana.length)];
      }
    }
    setGrid(newGrid);
    setGameActive(true);
    setScore(0);
    setSelection([]);
  };

  const handleCellClick = (r: number, c: number) => {
    if (!gameActive) return;
    
    const isAlreadySelected = selection.some(s => s.r === r && s.c === c);
    if (isAlreadySelected) {
      setSelection(selection.filter(s => !(s.r === r && s.c === c)));
    } else {
      setSelection([...selection, { r, c }]);
    }
  };

  useEffect(() => {
    if (selection.length > 1) {
      const selectedWord = selection.map(s => grid[s.r][s.c]).join('');
      const wordIndex = words.findIndex(w => w.word === selectedWord && !w.found);
      
      if (wordIndex !== -1) {
        const newWords = [...words];
        newWords[wordIndex].found = true;
        setWords(newWords);
        setScore(s => s + 100);
        setSelection([]);
        
        if (newWords.every(w => w.found)) {
          setGameActive(false);
        }
      }
    }
  }, [selection, words, grid]);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <button onClick={onBack} className="p-2 hover:bg-stone-100 rounded-full transition-colors">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div className="text-center">
          <h2 className="text-3xl font-editorial italic">Word Search</h2>
          <p className="text-stone-500 font-mono text-xs uppercase tracking-widest">Score: {score}</p>
        </div>
        <div className="w-10" />
      </div>

      {!gameActive && score === 0 ? (
        <div className="text-center py-20 bg-white rounded-[3rem] border border-stone-100 shadow-xl">
          <Search className="w-16 h-16 mx-auto mb-6 text-stone-300" />
          <h3 className="text-2xl font-serif italic mb-4">Find the Hidden Words</h3>
          <button 
            onClick={generateGrid}
            className="px-8 py-3 bg-stone-900 text-white rounded-full hover:bg-stone-800 transition-all"
          >
            Start Game
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-2 bg-white p-4 rounded-[2rem] border border-stone-100 shadow-xl">
            <div className="grid grid-cols-10 gap-1 aspect-square">
              {grid.map((row, r) => row.map((char, c) => (
                <button
                  key={`${r}-${c}`}
                  onClick={() => handleCellClick(r, c)}
                  className={cn(
                    "aspect-square flex items-center justify-center text-lg font-serif rounded-lg transition-all",
                    selection.some(s => s.r === r && s.c === c)
                      ? "bg-stone-900 text-white scale-95"
                      : "bg-stone-50 text-stone-600 hover:bg-stone-100"
                  )}
                >
                  {char}
                </button>
              )))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white p-6 rounded-[2rem] border border-stone-100 shadow-xl">
              <h4 className="text-xs font-mono uppercase tracking-widest text-stone-400 mb-4">Words to Find</h4>
              <div className="space-y-3">
                {words.map((w, i) => (
                  <div 
                    key={i}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-xl transition-all",
                      w.found ? "bg-emerald-50 text-emerald-600 line-through opacity-50" : "bg-stone-50 text-stone-900"
                    )}
                  >
                    <span className="text-lg font-serif">{w.word}</span>
                    {w.found && <Check className="w-4 h-4" />}
                  </div>
                ))}
              </div>
            </div>

            {!gameActive && score > 0 && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-emerald-600 text-white p-6 rounded-[2rem] text-center"
              >
                <h3 className="text-xl font-serif italic mb-2">Well Done!</h3>
                <p className="text-sm opacity-90 mb-4">You found all the words.</p>
                <button 
                  onClick={generateGrid}
                  className="w-full py-3 bg-white text-emerald-600 rounded-xl font-medium hover:bg-stone-50 transition-all"
                >
                  Play Again
                </button>
              </motion.div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const KanaInvaders = ({ onBack }: { onBack: () => void }) => {
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [gameState, setGameState] = useState<'start' | 'playing' | 'end'>('start');
  const [invaders, setInvaders] = useState<{ id: number; char: string; x: number; y: number }[]>([]);
  const [input, setInput] = useState('');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const gameLoopRef = useRef<number | null>(null);
  const nextIdRef = useRef(0);

  const allKana = [...hiragana, ...katakana];

  const startGame = (diff: 'easy' | 'medium' | 'hard') => {
    setDifficulty(diff);
    setGameState('playing');
    setScore(0);
    setTimeLeft(60);
    setInvaders([]);
    setInput('');
  };

  const spawnInvader = useCallback(() => {
    const kana = allKana[Math.floor(Math.random() * allKana.length)];
    const newInvader = {
      id: nextIdRef.current++,
      char: kana.kana,
      romaji: kana.romaji,
      x: Math.random() * 80 + 10,
      y: -10
    };
    setInvaders(prev => [...prev, newInvader]);
  }, []);

  useEffect(() => {
    if (gameState === 'playing') {
      const getBaseInterval = () => {
        switch (difficulty) {
          case 'easy': return 3000;
          case 'medium': return 2000;
          case 'hard': return 1200;
        }
      };

      const spawnInterval = setInterval(spawnInvader, getBaseInterval() - Math.min(score * 12, getBaseInterval() * 0.7));
      const timerInterval = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
      
      const gameLoop = () => {
        const getBaseSpeed = () => {
          switch (difficulty) {
            case 'easy': return 0.15;
            case 'medium': return 0.25;
            case 'hard': return 0.4;
          }
        };

        setInvaders(prev => {
          const next = prev.map(inv => ({ ...inv, y: inv.y + getBaseSpeed() + (score / 300) }));
          if (next.some(inv => inv.y > 100)) {
            setGameState('end');
            return [];
          }
          return next;
        });
        gameLoopRef.current = requestAnimationFrame(gameLoop);
      };
      gameLoopRef.current = requestAnimationFrame(gameLoop);

      return () => {
        clearInterval(spawnInterval);
        clearInterval(timerInterval);
        cancelAnimationFrame(gameLoopRef.current!);
      };
    }
  }, [gameState, spawnInvader, difficulty, score]);

  useEffect(() => {
    if (timeLeft <= 0) setGameState('end');
  }, [timeLeft]);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toLowerCase();
    setInput(val);
    
    const invaderIndex = invaders.findIndex(inv => {
      const kana = allKana.find(k => k.kana === inv.char);
      return kana?.romaji === val;
    });

    if (invaderIndex !== -1) {
      setInvaders(prev => prev.filter((_, i) => i !== invaderIndex));
      setScore(prev => prev + 10);
      setInput('');
    }
  };

  return (
    <div className="max-w-4xl mx-auto h-[750px] flex flex-col">
      <div className="mb-6 flex justify-between items-end">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="w-10 h-10 bg-white border border-stone-100 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-900 shadow-sm"><ChevronLeft className="w-5 h-5" /></button>
          <div>
            <h2 className="text-2xl font-editorial italic text-stone-900 mb-1">Kana Invaders</h2>
            <p className="text-stone-500 font-serif italic text-xs">Type the romaji before the kana reach the bottom.</p>
          </div>
        </div>
        <div className="flex gap-6">
          <div className="text-right">
            <div className="text-[8px] font-bold uppercase tracking-widest text-stone-400">Time</div>
            <div className="text-2xl font-editorial italic text-stone-900">{timeLeft}s</div>
          </div>
          <div className="text-right">
            <div className="text-[8px] font-bold uppercase tracking-widest text-stone-400">Score</div>
            <div className="text-2xl font-editorial italic text-stone-900">{score}</div>
          </div>
        </div>
      </div>

      <div className="flex-1 bg-stone-900 rounded-[3rem] relative overflow-hidden border-8 border-stone-800 shadow-2xl">
        {gameState === 'start' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-12 text-center">
            <Gamepad2 className="w-16 h-16 mb-6 text-blue-400" />
            <h3 className="text-3xl font-editorial italic mb-4">Protect the Base!</h3>
            <p className="text-stone-400 mb-8">Type the romaji for the falling kana before they reach the bottom.</p>
            
            <div className="flex gap-3 mb-8">
              {(['easy', 'medium', 'hard'] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDifficulty(d)}
                  className={cn(
                    "px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all",
                    difficulty === d 
                      ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20" 
                      : "bg-stone-800 text-stone-400 hover:bg-stone-700"
                  )}
                >
                  {d}
                </button>
              ))}
            </div>

            <button onClick={() => startGame(difficulty)} className="px-12 py-5 bg-white text-stone-900 rounded-full font-bold hover:bg-stone-100 transition-all">Start Game</button>
          </div>
        ) : gameState === 'playing' ? (
          <>
            {invaders.map(inv => (
              <motion.div 
                key={inv.id}
                className="absolute text-4xl font-bold text-white"
                style={{ left: `${inv.x}%`, top: `${inv.y}%` }}
              >
                {inv.char}
              </motion.div>
            ))}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-12 text-center">
            <Trophy className="w-16 h-16 mb-4 text-yellow-400" />
            <h3 className="text-3xl font-editorial italic mb-2">Game Over</h3>
            <p className="text-stone-400 mb-8">Final Score: {score}</p>
            <div className="flex gap-4">
              <button onClick={() => startGame(difficulty)} className="px-12 py-5 bg-white text-stone-900 rounded-full font-bold hover:bg-stone-100 transition-all">Try Again</button>
              <button onClick={() => setGameState('start')} className="px-12 py-5 bg-stone-800 text-white rounded-full font-bold hover:bg-stone-700 transition-all">Menu</button>
            </div>
          </div>
        )}
      </div>

      {gameState === 'playing' && (
        <div className="mt-8 w-full max-w-xs mx-auto px-4">
          <input 
            autoFocus
            value={input}
            onChange={handleInput}
            className="w-full p-4 bg-stone-900 border-2 border-stone-800 rounded-2xl text-center text-white text-2xl outline-none focus:ring-4 ring-blue-500/20 shadow-2xl"
            placeholder="Type romaji..."
          />
        </div>
      )}
    </div>
  );
};

const TypingGame = ({ vocab, onBack }: { vocab: Vocabulary[]; onBack: () => void }) => {
  const [gameStarted, setGameStarted] = useState(false);
  const [score, setScore] = useState(0);
  const [bubbles, setBubbles] = useState<{ id: number; text: string; romaji: string; x: number; y: number; speed: number }[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [gameOver, setGameOver] = useState(false);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [highScore, setHighScore] = useState(() => Number(localStorage.getItem('komorebi_game_highscore') || 0));
  const gameAreaRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);

  const startLevel = (diff: 'easy' | 'medium' | 'hard') => {
    setDifficulty(diff);
    setGameStarted(true);
    setScore(0);
    setBubbles([]);
    setGameOver(false);
    setInputValue('');
  };

  useEffect(() => {
    if (!gameStarted || gameOver) return;

    const getBaseInterval = () => {
      switch (difficulty) {
        case 'easy': return 3500;
        case 'medium': return 2500;
        case 'hard': return 1500;
      }
    };

    const interval = setInterval(() => {
      const source = vocab.length > 5 ? vocab : hiragana.concat(katakana);
      const item = source[Math.floor(Math.random() * source.length)];
      
      let text, romaji;
      if ('japanese' in item) {
        text = item.japanese;
        romaji = item.romaji;
      } else {
        text = item.kana;
        romaji = item.romaji;
      }

      const getBaseSpeed = () => {
        switch (difficulty) {
          case 'easy': return 0.2;
          case 'medium': return 0.4;
          case 'hard': return 0.6;
        }
      };

      const newBubble = {
        id: nextId.current++,
        text,
        romaji: romaji.toLowerCase(),
        x: Math.random() * 80 + 10, // 10% to 90%
        y: -10,
        speed: getBaseSpeed() + Math.random() * 0.5 + (score / 200)
      };
      setBubbles(prev => [...prev, newBubble]);
    }, getBaseInterval() - Math.min(score * 15, getBaseInterval() * 0.7));

    return () => clearInterval(interval);
  }, [gameStarted, gameOver, vocab, score, difficulty]);

  useEffect(() => {
    if (!gameStarted || gameOver) return;

    const animationFrame = requestAnimationFrame(function animate() {
      setBubbles(prev => {
        const next = prev.map(b => ({ ...b, y: b.y + b.speed }));
        if (next.some(b => b.y > 100)) {
          setGameOver(true);
          if (score > highScore) {
            setHighScore(score);
            localStorage.setItem('komorebi_game_highscore', score.toString());
          }
          return next;
        }
        return next;
      });
      requestAnimationFrame(animate);
    });

    return () => cancelAnimationFrame(animationFrame);
  }, [gameStarted, gameOver, score, highScore]);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toLowerCase();
    setInputValue(val);

    const matchIndex = bubbles.findIndex(b => b.romaji === val);
    if (matchIndex !== -1) {
      setScore(prev => prev + 10);
      setBubbles(prev => prev.filter((_, i) => i !== matchIndex));
      setInputValue('');
    }
  };

  return (
    <div className="max-w-4xl mx-auto h-[750px] flex flex-col">
      <div className="mb-6 flex justify-between items-end">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="w-10 h-10 bg-white border border-stone-100 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-900 hover:bg-stone-50 transition-all shadow-sm"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl font-editorial italic text-stone-900 mb-1">Typing Game</h2>
            <p className="text-stone-500 font-serif italic text-xs">Type the romaji before the bubbles hit the ground.</p>
          </div>
        </div>
        <div className="flex gap-4">
          <div className="text-right">
            <div className="text-[8px] font-bold uppercase tracking-widest text-stone-400">Score</div>
            <div className="text-2xl font-editorial italic text-stone-900">{score}</div>
          </div>
          <div className="text-right">
            <div className="text-[8px] font-bold uppercase tracking-widest text-stone-400">High Score</div>
            <div className="text-2xl font-editorial italic text-stone-400">{highScore}</div>
          </div>
        </div>
      </div>

      <div 
        ref={gameAreaRef}
        className="flex-1 bg-white rounded-[2.5rem] border border-stone-100 shadow-inner relative overflow-hidden"
      >
        {!gameStarted ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center mb-6">
              <Brain className="w-10 h-10 text-stone-900" />
            </div>
            <h3 className="text-2xl font-editorial italic text-stone-900 mb-2">Ready to type?</h3>
            <p className="text-stone-500 font-serif italic text-sm mb-8 max-w-xs">
              Bubbles will fall with Japanese characters. Type their romaji equivalents to pop them.
            </p>
            
            <div className="flex gap-3 mb-8">
              {(['easy', 'medium', 'hard'] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDifficulty(d)}
                  className={cn(
                    "px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all",
                    difficulty === d 
                      ? "bg-stone-900 text-white shadow-lg" 
                      : "bg-stone-50 text-stone-400 hover:bg-stone-100"
                  )}
                >
                  {d}
                </button>
              ))}
            </div>

            <button 
              onClick={() => startLevel(difficulty)}
              className="px-12 py-4 bg-stone-900 text-white rounded-full font-bold hover:bg-stone-800 transition-all shadow-xl shadow-stone-100 flex items-center gap-2"
            >
              <Play className="w-5 h-5" /> Start Game
            </button>
          </div>
        ) : gameOver ? (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center p-8 text-center z-20">
            <h3 className="text-4xl font-editorial italic text-red-600 mb-2">Game Over</h3>
            <p className="text-stone-500 font-serif italic text-lg mb-8">Final Score: {score}</p>
            <div className="flex gap-4">
              <button 
                onClick={() => startLevel(difficulty)}
                className="px-10 py-4 bg-stone-900 text-white rounded-full font-bold hover:bg-stone-800 transition-all shadow-xl shadow-stone-100"
              >
                Try Again
              </button>
              <button 
                onClick={() => setGameStarted(false)}
                className="px-10 py-4 bg-stone-50 text-stone-900 rounded-full font-bold hover:bg-stone-100 transition-all"
              >
                Menu
              </button>
            </div>
          </div>
        ) : (
          <>
            <AnimatePresence>
              {bubbles.map(bubble => (
                <motion.div
                  key={bubble.id}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 1.5, opacity: 0, transition: { duration: 0.2 } }}
                  style={{ 
                    position: 'absolute', 
                    left: `${bubble.x}%`, 
                    top: `${bubble.y}%`,
                    transform: 'translateX(-50%)'
                  }}
                  className="w-14 h-14 bg-white border-2 border-stone-100 rounded-full shadow-lg flex flex-col items-center justify-center z-10"
                >
                  <span className="text-base font-bold text-stone-900">{bubble.text}</span>
                  <div className="text-[6px] font-mono text-stone-300 uppercase tracking-tighter mt-0.5">{bubble.romaji}</div>
                </motion.div>
              ))}
            </AnimatePresence>
            {/* Ground */}
            <div className="absolute bottom-0 left-0 right-0 h-2 bg-red-50 border-t border-red-100" />
          </>
        )}
      </div>

      {gameStarted && !gameOver && (
        <div className="mt-8 w-full max-w-xs mx-auto px-4">
          <input 
            autoFocus
            value={inputValue}
            onChange={handleInput}
            placeholder="Type romaji..."
            className="w-full p-4 bg-white border-2 border-stone-900 rounded-2xl shadow-2xl text-center font-mono text-lg outline-none focus:ring-4 ring-stone-100 transition-all"
          />
        </div>
      )}
    </div>
  );
};

const Phrasebook = () => {
  const [activeCategory, setActiveCategory] = useState('Greetings');
  const { play, loading: ttsLoading } = useTTSContext();

  const categories = {
    'Greetings': [
      { jp: "おはようございます", ro: "Ohayou gozaimasu", en: "Good morning" },
      { jp: "こんにちは", ro: "Konnichiwa", en: "Hello / Good afternoon" },
      { jp: "こんばんは", ro: "Konbanwa", en: "Good evening" },
      { jp: "おやすみなさい", ro: "Oyasumi nasai", en: "Good night" },
      { jp: "お元気ですか？", ro: "O-genki desu ka?", en: "How are you?" },
    ],
    'Travel': [
      { jp: "駅はどこですか？", ro: "Eki wa doko desu ka?", en: "Where is the station?" },
      { jp: "切符を一枚ください", ro: "Kippu o ichimai kudasai", en: "One ticket, please" },
      { jp: "いくらですか？", ro: "Ikura desu ka?", en: "How much is it?" },
      { jp: "助けてください", ro: "Tasukete kudasai", en: "Please help me" },
    ],
    'Food': [
      { jp: "メニューをください", ro: "Menyuu o kudasai", en: "Menu, please" },
      { jp: "これをお願いします", ro: "Kore o onegaishimasu", en: "This one, please" },
      { jp: "お会計をお願いします", ro: "O-kaikei o onegaishimasu", en: "The bill, please" },
      { jp: "いただきます", ro: "Itadakimasu", en: "Let's eat (Before meal)" },
      { jp: "ごちそうさまでした", ro: "Gochisousama deshita", en: "Thank you for the meal" },
    ]
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-10">
        <h2 className="text-4xl font-editorial italic text-stone-900 mb-2">Essential Phrasebook</h2>
        <p className="text-stone-500 font-serif italic">Quick access to common Japanese expressions for daily life.</p>
      </div>

      <div className="flex gap-4 mb-8 overflow-x-auto pb-2 scrollbar-hide">
        {Object.keys(categories).map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={cn(
              "px-8 py-3 rounded-full font-bold transition-all whitespace-nowrap",
              activeCategory === cat ? "bg-stone-900 text-white shadow-lg" : "bg-white text-stone-500 hover:bg-stone-50 border border-stone-100"
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {categories[activeCategory as keyof typeof categories].map((phrase, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-stone-50 flex justify-between items-center group hover:border-stone-200 transition-all"
          >
            <div className="space-y-2">
              <div className="text-2xl font-serif text-stone-900">{phrase.jp}</div>
              <div className="text-xs font-mono text-stone-400 uppercase tracking-widest">{phrase.ro}</div>
              <div className="text-stone-600 font-editorial italic">{phrase.en}</div>
            </div>
            <button
              onClick={() => play(phrase.jp)}
              disabled={ttsLoading}
              className="p-4 bg-stone-50 rounded-full text-stone-300 group-hover:text-stone-900 group-hover:bg-stone-100 transition-all"
            >
              <Volume2 className={cn("w-5 h-5", ttsLoading && "animate-pulse")} />
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

// --- Main App ---

const MissingApiKeyWarning = () => (
  <motion.div 
    initial={{ opacity: 0, scale: 0.95 }}
    animate={{ opacity: 1, scale: 1 }}
    className="bg-amber-50 border border-amber-100 p-8 rounded-[2.5rem] text-center space-y-4 shadow-xl shadow-amber-900/5"
  >
    <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto shadow-sm">
      <AlertCircle className="w-8 h-8 text-amber-500 animate-pulse" />
    </div>
    <h3 className="text-xl font-editorial italic text-stone-900">API Key Required</h3>
    <p className="text-stone-600 font-serif italic text-sm max-w-md mx-auto">
      To use the AI features like Sensei Chat, Translator, and Dictionary, you need to add your Gemini API Key to the application's secrets.
    </p>
    <div className="bg-white p-6 rounded-2xl text-left text-xs space-y-3 border border-amber-50 shadow-sm">
      <p className="font-bold text-stone-900 uppercase tracking-widest">How to fix:</p>
      <ol className="list-decimal list-inside space-y-2 text-stone-500">
        <li>Get a free key from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-blue-500 underline font-bold">Google AI Studio</a></li>
        <li>Open <b>Settings</b> (⚙️ gear icon, top-right) in this app</li>
        <li>Go to <b>Secrets</b> section</li>
        <li>Add <code>GEMINI_API_KEY</code> with your key as the value</li>
        <li>The app will rebuild automatically</li>
      </ol>
    </div>
  </motion.div>
);

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'vocab' | 'vocabList' | 'quiz' | 'dictionary' | 'flashcards' | 'translator' | 'kana' | 'phrasebook' | 'settings' | 'game' | 'chatbot' | 'notebook' | 'invaders' | 'wordsearch'>('dashboard');

  useEffect(() => {
    (window as any).setActiveTab = setActiveTab;
  }, []);
  const [vocab, setVocab] = useState<Vocabulary[]>([]);
  const [todayVocabCount, setTodayVocabCount] = useState(0);
  const [isDemo, setIsDemo] = useState(localStorage.getItem('komorebi_demo') === 'true');
  const [streakWarning, setStreakWarning] = useState(false);

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

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser && !isDemo) {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, [isDemo]);

  // Data listener for authenticated user
  useEffect(() => {
    if (!user) return;

    setLoading(true);
    const profileRef = doc(db, 'users', user.uid);
    
    // Initial connection test
    getDocFromServer(profileRef).catch(e => console.error("Firebase connection test failed", e));

    const unsubProfile = onSnapshot(profileRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as UserProfile;
        setProfile(data);

        // Check streak logic
        const lastDate = data.lastActiveDate?.toDate();
        if (lastDate && !isToday(lastDate)) {
          const diff = differenceInDays(startOfDay(new Date()), startOfDay(lastDate));
          if (diff > 1) {
            updateDoc(profileRef, { streakCount: 0, dailyGoalMet: false }).catch(e => console.error("Streak reset failed", e));
          } else {
            updateDoc(profileRef, { dailyGoalMet: false }).catch(e => console.error("Daily goal reset failed", e));
          }
        }
      } else {
        const newProfile: UserProfile = {
          uid: user.uid,
          displayName: user.displayName,
          email: user.email,
          streakCount: 0,
          lastActiveDate: Timestamp.now(),
          dailyGoalMet: false,
          xp: 0
        };
        setDoc(profileRef, newProfile).catch(e => console.error("Profile creation failed", e));
        setProfile(newProfile);
      }
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
      setLoading(false);
    });

    const vocabRef = collection(db, 'users', user.uid, 'vocabularies');
    const q = query(vocabRef, orderBy('createdAt', 'desc'));
    const unsubVocab = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Vocabulary));
      setVocab(list);
      setTodayVocabCount(list.filter(v => isToday(v.createdAt.toDate())).length);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, `users/${user.uid}/vocabularies`);
      setLoading(false);
    });

    return () => {
      unsubProfile();
      unsubVocab();
    };
  }, [user]);

  // Demo mode listener
  useEffect(() => {
    if (!isDemo || user) return;

    const loadDemoData = () => {
      const p = JSON.parse(localStorage.getItem('komorebi_profile') || '{}');
      const v = JSON.parse(localStorage.getItem('komorebi_vocab') || '[]');
      
      const vocabList = v.map((item: any) => ({
        ...item,
        createdAt: item.createdAt?.seconds ? new Timestamp(item.createdAt.seconds, item.createdAt.nanoseconds) : Timestamp.now()
      }));

      const lastDate = p.lastActiveDate?.seconds ? new Timestamp(p.lastActiveDate.seconds, p.lastActiveDate.nanoseconds).toDate() : null;
      let streakCount = p.streakCount || 0;
      let dailyGoalMet = p.dailyGoalMet || false;

      if (lastDate && !isToday(lastDate)) {
        const diff = differenceInDays(startOfDay(new Date()), startOfDay(lastDate));
        if (diff > 1) {
          streakCount = 0;
          dailyGoalMet = false;
        } else {
          dailyGoalMet = false;
        }
        localStorage.setItem('komorebi_profile', JSON.stringify({ ...p, streakCount, dailyGoalMet, lastActiveDate: Timestamp.now() }));
      }

      setProfile({
        uid: 'guest',
        displayName: 'Guest Learner',
        email: 'guest@example.com',
        streakCount,
        dailyGoalMet,
        xp: 0,
        ...p,
        lastActiveDate: p.lastActiveDate?.seconds ? new Timestamp(p.lastActiveDate.seconds, p.lastActiveDate.nanoseconds) : Timestamp.now()
      });
      setVocab(vocabList);
      setTodayVocabCount(vocabList.filter((item: any) => isToday(item.createdAt.toDate())).length);
      setLoading(false);
    };

    loadDemoData();
    window.addEventListener('vocab_update', loadDemoData);
    return () => window.removeEventListener('vocab_update', loadDemoData);
  }, [isDemo, user]);

  // Streak update logic for authenticated user
  useEffect(() => {
    if (!user || !profile || profile.dailyGoalMet) return;
    if (todayVocabCount >= 5) {
      const profileRef = doc(db, 'users', user.uid);
      updateDoc(profileRef, { 
        dailyGoalMet: true, 
        streakCount: (profile.streakCount || 0) + 1,
        lastActiveDate: Timestamp.now(),
        xp: (profile.xp || 0) + 50
      });
    }
  }, [todayVocabCount, user, profile?.dailyGoalMet]);

  // Streak update logic for demo mode
  useEffect(() => {
    if (!isDemo || user || !profile || profile.dailyGoalMet) return;
    if (todayVocabCount >= 5) {
      const p = JSON.parse(localStorage.getItem('komorebi_profile') || '{}');
      const updatedProfile = {
        ...p,
        streakCount: (p.streakCount || 0) + 1,
        dailyGoalMet: true,
        lastActiveDate: Timestamp.now(),
        xp: (p.xp || 0) + 50
      };
      localStorage.setItem('komorebi_profile', JSON.stringify(updatedProfile));
      setProfile(updatedProfile as any);
    }
  }, [todayVocabCount, isDemo, user, profile?.dailyGoalMet]);

  // Safety timeout
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (loading) {
        console.log("Loading timeout reached...");
        setLoading(false);
      }
    }, 5000);
    return () => clearTimeout(timeout);
  }, [loading]);

  // Streak warning notification
  useEffect(() => {
    if (!profile || !profile.notificationsEnabled || profile.dailyGoalMet) return;
    
    const checkStreak = () => {
      const now = new Date();
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      const hoursLeft = (endOfDay.getTime() - now.getTime()) / (1000 * 60 * 60);
      
      if (hoursLeft <= 4 && hoursLeft > 0) {
        setStreakWarning(true);
      } else {
        setStreakWarning(false);
      }
    };

    checkStreak();
    const interval = setInterval(checkStreak, 1000 * 60 * 15); // Check every 15 mins
    return () => clearInterval(interval);
  }, [profile]);

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
  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, logout, setDemoMode, isDemo }}>
      <TTSProvider>
        <ErrorBoundary>
          {!user && !isDemo ? (
            <Login />
          ) : (
            <AppContent activeTab={activeTab} setActiveTab={setActiveTab} todayVocabCount={todayVocabCount} vocab={vocab} logout={logout} streakWarning={streakWarning} />
          )}
        </ErrorBoundary>
      </TTSProvider>
    </AuthContext.Provider>
  );
}

const NamePrompt = ({ onSave }: { onSave: (name: string) => void }) => {
  const [name, setName] = useState('');
  
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-stone-900/60 backdrop-blur-md"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative w-full max-w-md bg-white rounded-[3rem] shadow-2xl p-10 text-center"
      >
        <div className="w-20 h-20 bg-stone-900 rounded-3xl flex items-center justify-center text-white text-3xl font-bold mx-auto mb-8 shadow-xl shadow-stone-200">木</div>
        <h2 className="text-3xl font-editorial italic text-stone-900 mb-2">Welcome to Komorebi</h2>
        <p className="text-stone-500 font-serif italic mb-8">What should we call you on your journey?</p>
        
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(name.trim()); }} className="space-y-4">
          <input 
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name..."
            className="w-full p-5 bg-stone-50 border-none rounded-2xl text-center text-xl font-medium focus:ring-2 focus:ring-stone-200 transition-all outline-none"
          />
          <button 
            type="submit"
            disabled={!name.trim()}
            className="w-full py-5 bg-stone-900 text-white rounded-full font-bold hover:bg-stone-800 transition-all shadow-xl shadow-stone-200 disabled:opacity-50"
          >
            Start Learning
          </button>
        </form>
      </motion.div>
    </div>
  );
};

const AppContent = ({ activeTab, setActiveTab, todayVocabCount, vocab, logout, streakWarning }: any) => {
  const { profile, user, isDemo } = useContext(AuthContext);
  const { quotaExhausted } = useTTSContext();
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  
  const isNewUser = profile && (profile.displayName === 'Guest Learner' || !profile.displayName);

  const handleSaveName = async (name: string) => {
    if (isDemo) {
      const p = JSON.parse(localStorage.getItem('komorebi_profile') || '{}');
      localStorage.setItem('komorebi_profile', JSON.stringify({ ...p, displayName: name }));
      window.location.reload(); // Refresh to apply
    } else if (user) {
      await updateDoc(doc(db, 'users', user.uid), { displayName: name });
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f2ed] pb-20 md:pb-0 md:pl-56">
      <AnimatePresence>
        {isNewUser && <NamePrompt onSave={handleSaveName} />}
      </AnimatePresence>
      {/* Quota Warning */}
      <AnimatePresence>
        {quotaExhausted && (
          <motion.div 
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-full max-w-md px-4"
          >
            <div className="bg-orange-600 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-orange-500/20 backdrop-blur-sm">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-bold">AI Voice Quota Reached</p>
                <p className="text-[10px] opacity-90">Automatically switched to Built-in voice for today.</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Streak Warning */}
      <AnimatePresence>
        {streakWarning && (
          <motion.div 
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] w-full max-w-md px-4"
          >
            <div className="bg-red-600 text-white px-6 py-4 rounded-3xl shadow-2xl flex items-center gap-4 border border-red-500/20 backdrop-blur-md">
              <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center shrink-0">
                <Flame className="w-6 h-6 text-white animate-pulse" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold">Streak in Danger!</p>
                <p className="text-[10px] opacity-90">Only a few hours left to hit your daily goal.</p>
              </div>
              <button 
                onClick={() => setActiveTab('vocab')}
                className="px-4 py-2 bg-white text-red-600 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-stone-50 transition-all"
              >
                Study Now
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-56 bg-white border-r border-stone-100 flex-col fixed inset-y-0 left-0 z-50">
            <div className="p-6 flex items-center gap-2">
              <div className="w-8 h-8 bg-stone-900 rounded-lg flex items-center justify-center text-white font-bold shrink-0 text-sm">木</div>
              <span className="font-serif font-bold text-lg tracking-tight">Komorebi</span>
            </div>
            
            <nav className="flex-1 px-3 space-y-1 mt-2">
              <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-widest text-stone-400">Main</div>
              {[
                { id: 'dashboard', icon: Flame, label: 'Home' },
                { id: 'kana', icon: Pencil, label: 'Writing' },
                { id: 'vocab', icon: PlusCircle, label: 'Add Word' },
                { id: 'quiz', icon: Brain, label: 'Test' },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as any)}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-xl transition-all group relative",
                    activeTab === item.id 
                      ? "bg-stone-900 text-white shadow-lg shadow-stone-200" 
                      : "text-stone-400 hover:bg-stone-50 hover:text-stone-900"
                  )}
                >
                  <item.icon className={cn("w-4 h-4 transition-transform group-hover:scale-110", activeTab === item.id ? "text-white" : "text-stone-400 group-hover:text-stone-900")} />
                  <span className="font-medium text-xs tracking-wide">{item.label}</span>
                  {activeTab === item.id && (
                    <motion.div 
                      layoutId="activeTabDesktop"
                      className="absolute inset-0 bg-stone-900 rounded-xl -z-10"
                      transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                    />
                  )}
                </button>
              ))}

              <div className="px-3 mt-6 mb-2 text-[10px] font-bold uppercase tracking-widest text-stone-400">More</div>
              {[
                { id: 'vocabList', icon: Library, label: 'Vocabulary' },
                { id: 'flashcards', icon: Layers, label: 'Review' },
                { id: 'game', icon: Gamepad2, label: 'Games' },
                { id: 'dictionary', icon: BookOpen, label: 'Dictionary' },
                { id: 'translator', icon: Languages, label: 'Translate' },
                { id: 'phrasebook', icon: MessageSquare, label: 'Phrases' },
                { id: 'chatbot', icon: MessageSquare, label: 'Sensei Chat' },
                { id: 'notebook', icon: BookOpen, label: 'Notebook' },
                { id: 'settings', icon: Settings2, label: 'Settings' },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as any)}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-xl transition-all group relative",
                    activeTab === item.id 
                      ? "bg-stone-900 text-white shadow-lg shadow-stone-200" 
                      : "text-stone-400 hover:bg-stone-50 hover:text-stone-900"
                  )}
                >
                  <item.icon className={cn("w-4 h-4 transition-transform group-hover:scale-110", activeTab === item.id ? "text-white" : "text-stone-400 group-hover:text-stone-900")} />
                  <span className="font-medium text-xs tracking-wide">{item.label}</span>
                  {activeTab === item.id && (
                    <motion.div 
                      layoutId="activeTabDesktop"
                      className="absolute inset-0 bg-stone-900 rounded-xl -z-10"
                      transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                    />
                  )}
                </button>
              ))}
            </nav>

            <div className="p-4 border-t border-stone-50">
              <button 
                onClick={logout}
                className="w-full flex items-center gap-3 p-3 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
              >
                <LogOut className="w-4 h-4" />
                <span className="font-medium text-xs">Logout</span>
              </button>
            </div>
          </aside>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-stone-100 px-1 py-2 flex justify-around items-center z-[100] shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
        {[
          { id: 'dashboard', icon: Flame, label: 'Home' },
          { id: 'kana', icon: Pencil, label: 'Writing' },
          { id: 'vocab', icon: PlusCircle, label: 'Add' },
          { id: 'quiz', icon: Brain, label: 'Test' },
          { id: 'more', icon: List, label: 'More' },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => {
              if (item.id === 'more') {
                setShowMoreMenu(true);
              } else {
                setActiveTab(item.id as any);
                setShowMoreMenu(false);
              }
            }}
            className={cn(
              "flex flex-col items-center gap-1 p-2 rounded-xl transition-all relative min-w-[64px]",
              activeTab === item.id || (item.id === 'more' && showMoreMenu)
                ? "text-stone-900" 
                : "text-stone-400"
            )}
          >
            <item.icon className={cn("w-5 h-5", (activeTab === item.id || (item.id === 'more' && showMoreMenu)) && "text-stone-900")} />
            <span className="text-[10px] font-bold uppercase tracking-tighter">{item.label}</span>
            {(activeTab === item.id || (item.id === 'more' && showMoreMenu)) && (
              <motion.div 
                layoutId="active-nav-pill"
                className="absolute inset-0 bg-stone-50 rounded-xl -z-10"
              />
            )}
          </button>
        ))}
      </nav>

      {/* Mobile More Menu Overlay */}
      <AnimatePresence>
        {showMoreMenu && (
          <div className="md:hidden fixed inset-0 z-[150] flex flex-col justify-end">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMoreMenu(false)}
              className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="relative bg-white rounded-t-[3rem] p-8 pb-12 shadow-2xl space-y-6"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xl font-editorial italic text-stone-900">More Options</h3>
                <button onClick={() => setShowMoreMenu(false)} className="p-2 text-stone-400">
                  <XCircle className="w-6 h-6" />
                </button>
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                {[
                  { id: 'vocabList', icon: Library, label: 'Library' },
                  { id: 'flashcards', icon: Layers, label: 'Review' },
                  { id: 'game', icon: Gamepad2, label: 'Games' },
                  { id: 'dictionary', icon: BookOpen, label: 'Dict' },
                  { id: 'translator', icon: Languages, label: 'Translate' },
                  { id: 'phrasebook', icon: MessageSquare, label: 'Phrases' },
                  { id: 'chatbot', icon: MessageSquare, label: 'Chat' },
                  { id: 'notebook', icon: BookOpen, label: 'Notes' },
                  { id: 'settings', icon: Settings2, label: 'Settings' },
                ].map((item) => (
                  <motion.button
                    key={item.id}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => {
                      setActiveTab(item.id as any);
                      setShowMoreMenu(false);
                    }}
                    className={cn(
                      "flex flex-col items-center gap-2 p-4 rounded-2xl transition-all",
                      activeTab === item.id ? "bg-stone-900 text-white" : "bg-stone-50 text-stone-500 hover:bg-stone-100"
                    )}
                  >
                    <item.icon className="w-5 h-5" />
                    <span className="text-[10px] font-bold uppercase tracking-tighter">{item.label}</span>
                  </motion.button>
                ))}
              </div>

              <div className="pt-4">
                <button 
                  onClick={() => {
                    logout();
                    setShowMoreMenu(false);
                  }}
                  className="w-full flex items-center justify-center gap-3 p-4 text-red-500 bg-red-50 rounded-2xl font-bold text-sm"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

          {/* Main Content */}
          <main className="p-4 md:p-8 lg:p-10">
            <div className="max-w-5xl mx-auto">
              {/* Header for Mobile */}
              <div className="md:hidden flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 bg-stone-900 rounded-lg flex items-center justify-center text-white font-bold text-xs">木</div>
                  <span className="font-serif font-bold text-base tracking-tight">Komorebi</span>
                </div>
                <button onClick={logout} className="p-1.5 text-stone-400">
                  <LogOut className="w-4 h-4" />
                </button>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  {activeTab === 'dashboard' && <Dashboard vocabCount={todayVocabCount} vocab={vocab} />}
                  {activeTab === 'vocab' && <VocabEntry vocab={vocab} />}
                  {activeTab === 'vocabList' && <VocabList vocab={vocab} />}
                  {activeTab === 'flashcards' && <Flashcards vocab={vocab} />}
                  {activeTab === 'quiz' && <Quiz vocab={vocab} />}
                  {activeTab === 'dictionary' && <Dictionary />}
                  {activeTab === 'translator' && <Translator />}
                  {activeTab === 'phrasebook' && <Phrasebook />}
                  {activeTab === 'kana' && <WritingPractice />}
                  {activeTab === 'game' && <Games vocab={vocab} onSelectGame={(id) => setActiveTab(id as any)} />}
                  {activeTab === 'invaders' && <KanaInvaders onBack={() => setActiveTab('game')} />}
                  {activeTab === 'wordsearch' && <WordSearch onBack={() => setActiveTab('game')} />}
                  {activeTab === 'chatbot' && <Chatbot />}
                  {activeTab === 'notebook' && <Notebook />}
                  {activeTab === 'settings' && <Settings vocab={vocab} />}
                </motion.div>
              </AnimatePresence>
            </div>
          </main>
        </div>
      );
    };
