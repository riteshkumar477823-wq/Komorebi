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
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Gemini API Key is missing");
    
    try {
      const ai = new GoogleGenAI({ apiKey });
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
  const { play, loading: ttsLoading, mode, setTTSMode, hasJaVoice } = useTTSContext();
  const hasApiKey = !!(process.env.GEMINI_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY);

  const wordOfTheDay = vocab.length > 0 ? vocab[Math.floor(Math.random() * vocab.length)] : { japanese: "学習", romaji: "Gakushuu", meaning: "Study / Learning" };

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-editorial italic text-stone-900 mb-0.5">
            Okaeri, <span className="font-medium">{profile?.displayName?.split(' ')[0] || 'Learner'}</span>
          </h2>
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
        </div>
        <div className="flex items-center gap-3">
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
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div 
          whileHover={{ y: -2 }}
          className="lg:col-span-2 p-6 bg-white rounded-[2rem] shadow-sm border border-stone-50 flex flex-col justify-between min-h-[220px] relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
            <BookOpen className="w-32 h-32" />
          </div>
          <div className="relative z-10">
            <span className="text-stone-400 font-mono text-[8px] uppercase tracking-widest block mb-4">Word of the Day</span>
            <div className="flex items-end gap-4 mb-2">
              <h3 className="text-6xl font-serif text-stone-900">{wordOfTheDay.japanese}</h3>
              <button 
                onClick={() => play(wordOfTheDay.japanese)}
                disabled={ttsLoading}
                className="p-2 bg-stone-50 rounded-full text-stone-400 hover:text-stone-900 transition-all mb-2"
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
              className="px-6 py-2.5 bg-stone-900 text-white rounded-full font-bold text-xs hover:bg-stone-800 transition-all shadow-md shadow-stone-100"
            >
              Dictionary
            </button>
          </div>
        </motion.div>

        <motion.div 
          whileHover={{ y: -2 }}
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
                className="h-full bg-stone-900"
              />
            </div>
            <div className="mt-3 flex justify-between items-end">
              <p className="text-xs font-bold text-stone-900 uppercase tracking-widest">{vocabCount} / 5 words</p>
              {goalMet && <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Goal Met</span>}
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
      const apiKey = process.env.GEMINI_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY;
      if (!apiKey) throw new Error("API Key not found. Please check your environment variables.");

      const ai = new GoogleGenAI({ apiKey });
      const isJapanese = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(text);
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
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
      <div className="mb-10">
        <h2 className="text-4xl font-editorial italic text-stone-900 mb-2">Word Translator</h2>
        <p className="text-stone-500 font-serif italic">Fast, reliable word translations powered by Gemini AI.</p>
      </div>

      <div className="space-y-6">
        <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-stone-50">
          <div className="relative">
            <input 
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTranslate()}
              placeholder="Type a word in English or Japanese..."
              className="w-full p-6 bg-stone-50 border-none rounded-2xl focus:ring-2 focus:ring-stone-100 transition-all text-xl outline-none"
            />
            {text && (
              <button 
                onClick={() => setText('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-stone-300 hover:text-stone-500"
              >
                <XCircle className="w-5 h-5" />
              </button>
            )}
          </div>
          <div className="mt-6 flex justify-end">
            <button 
              onClick={handleTranslate}
              disabled={loading || !text}
              className="px-10 py-4 bg-stone-900 text-white rounded-full font-bold hover:bg-stone-800 transition-all shadow-xl shadow-stone-100 disabled:opacity-50 flex items-center gap-2"
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
  const { play, loading: ttsLoading } = useTTSContext();

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
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-8">
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
      const apiKey = process.env.GEMINI_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY;
      if (!apiKey) throw new Error("API Key not found.");

      const ai = new GoogleGenAI({ apiKey });
      
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
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
      <div className="mb-8">
        <h2 className="text-3xl font-editorial italic text-stone-900 mb-2">Japanese Dictionary</h2>
        <p className="text-stone-500 font-serif italic">Search for any word or browse common expressions below.</p>
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
          disabled={loading || !query}
          className="absolute right-3 top-1/2 -translate-y-1/2 px-6 py-3 bg-stone-900 text-white rounded-full font-bold hover:bg-stone-800 transition-colors disabled:opacity-50"
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'vocab' | 'vocabList' | 'quiz' | 'dictionary' | 'flashcards' | 'translator' | 'kana' | 'phrasebook'>('dashboard');

  useEffect(() => {
    (window as any).setActiveTab = setActiveTab;
  }, []);
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
      <TTSProvider>
        <ErrorBoundary>
          <AppContent activeTab={activeTab} setActiveTab={setActiveTab} todayVocabCount={todayVocabCount} vocab={vocab} logout={logout} />
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

const AppContent = ({ activeTab, setActiveTab, todayVocabCount, vocab, logout }: any) => {
  const { profile, user, isDemo } = useContext(AuthContext);
  const { quotaExhausted } = useTTSContext();
  
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

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-56 bg-white border-r border-stone-100 flex-col fixed inset-y-0 left-0 z-50">
            <div className="p-6 flex items-center gap-2">
              <div className="w-8 h-8 bg-stone-900 rounded-lg flex items-center justify-center text-white font-bold shrink-0 text-sm">木</div>
              <span className="font-serif font-bold text-lg tracking-tight">Komorebi</span>
            </div>
            
            <nav className="flex-1 px-3 space-y-1 mt-2">
              {[
                { id: 'dashboard', icon: Flame, label: 'Home' },
                { id: 'vocab', icon: PlusCircle, label: 'Add Word' },
                { id: 'vocabList', icon: List, label: 'Manage Vocabulary' },
                { id: 'flashcards', icon: ChevronRight, label: 'Review' },
                { id: 'quiz', icon: Brain, label: 'Quiz' },
                { id: 'dictionary', icon: Search, label: 'Dictionary' },
                { id: 'translator', icon: Languages, label: 'Translate' },
                { id: 'phrasebook', icon: List, label: 'Phrases' },
                { id: 'kana', icon: Pencil, label: 'Writing' },
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
                  <item.icon className={cn("w-4 h-4", activeTab === item.id ? "text-white" : "text-stone-400 group-hover:text-stone-900")} />
                  <span className="font-medium text-xs tracking-wide">{item.label}</span>
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
              { id: 'dashboard', icon: Flame },
              { id: 'vocab', icon: PlusCircle },
              { id: 'vocabList', icon: List },
              { id: 'flashcards', icon: ChevronRight },
              { id: 'quiz', icon: Brain },
              { id: 'dictionary', icon: Search },
              { id: 'translator', icon: Languages },
              { id: 'phrasebook', icon: List },
              { id: 'kana', icon: Pencil },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as any)}
                className={cn(
                  "p-2.5 rounded-lg transition-all relative",
                  activeTab === item.id 
                    ? "bg-stone-900 text-white shadow-md shadow-stone-200" 
                    : "text-stone-400"
                )}
              >
                <item.icon className="w-4 h-4" />
                {activeTab === item.id && (
                  <motion.div 
                    layoutId="active-nav-dot"
                    className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-0.5 h-0.5 bg-white rounded-full"
                  />
                )}
              </button>
            ))}
          </nav>

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
                </motion.div>
              </AnimatePresence>
            </div>
          </main>
        </div>
      );
    };
