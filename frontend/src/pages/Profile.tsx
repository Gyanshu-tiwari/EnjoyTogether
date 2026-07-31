import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, Loader2, User, Mail, ShieldCheck, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuthSession } from '@/features/auth';
import { Card } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';
import { Avatar } from '@/shared/components/ui/Avatar';
import { Badge } from '@/shared/components/ui/Badge';
import { uploadAvatar, fetchProfile } from '@/features/profile/api/profileApi';

export default function ProfilePage() {
  const navigate = useNavigate();
  const { session } = useAuthSession();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  const user = session?.user;
  const username = user?.user_metadata?.username || '';
  const userEmail = user?.email || '';
  const displayName = username || userEmail.split('@')[0] || 'User';
  const userInitial = displayName.charAt(0).toUpperCase();

  // Load existing profile from backend on mount
  useEffect(() => {
    async function loadProfile() {
      if (!user?.id) return;
      setIsLoadingProfile(true);
      try {
        const profile = await fetchProfile();
        if (profile?.avatarUrl) {
          setAvatarUrl(profile.avatarUrl);
        } else if (user.user_metadata?.avatar_url) {
          setAvatarUrl(user.user_metadata.avatar_url);
        }
      } catch (err) {
        console.warn('Failed to load user profile from DB, using metadata fallback.');
        if (user.user_metadata?.avatar_url) {
          setAvatarUrl(user.user_metadata.avatar_url);
        }
      } finally {
        setIsLoadingProfile(false);
      }
    }
    loadProfile();
  }, [user]);

  const handleAvatarClick = () => {
    if (isUploading) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side file type verification
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Invalid file type. Please select an image file (PNG, JPG, WEBP).');
      setSuccessMsg(null);
      return;
    }

    setErrorMsg(null);
    setSuccessMsg(null);
    setIsUploading(true);

    try {
      if (!user?.id) throw new Error('You must be logged in to upload an avatar.');
      
      const uploadedUrl = await uploadAvatar(file, user.id);
      setAvatarUrl(uploadedUrl);
      setSuccessMsg('Avatar updated successfully!');
      
      // Auto-clear success message after 4 seconds
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      console.error('[ProfilePage] Upload error:', err);
      setErrorMsg(err.message || 'An error occurred during avatar upload.');
    } finally {
      setIsUploading(false);
      // Reset input value to allow selecting same file again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto py-4 px-2">
      {/* Back navigation header */}
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="secondary"
          className="h-9 w-9 p-0 flex items-center justify-center bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-neutral-200"
          onClick={() => navigate('/')}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-white">Profile Settings</h1>
          <p className="text-xs text-neutral-450">Manage your avatar and view account metadata</p>
        </div>
      </div>

      {/* Main card */}
      <Card className="bg-neutral-900 border border-neutral-850 p-6 rounded-2xl shadow-xl backdrop-filter-none">
        
        {/* Status Alerts */}
        {successMsg && (
          <div className="mb-6 flex items-center gap-3 p-3 bg-emerald-950/40 border border-emerald-900 text-emerald-450 rounded-xl text-xs font-medium animate-fade-in">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="mb-6 flex items-center gap-3 p-3 bg-red-950/40 border border-red-900 text-red-450 rounded-xl text-xs font-medium animate-fade-in">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-8 items-center md:items-start">
          
          {/* Avatar upload wrapper */}
          <div className="relative group">
            <div 
              onClick={handleAvatarClick}
              className={`relative cursor-pointer rounded-full overflow-hidden border-2 transition-all duration-300 ${
                isUploading 
                  ? 'border-indigo-500 scale-95 opacity-80' 
                  : 'border-neutral-800 hover:border-indigo-500 hover:scale-[1.02]'
              }`}
            >
              {isLoadingProfile ? (
                <div className="w-24 h-24 rounded-full bg-neutral-950 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
                </div>
              ) : (
                <Avatar 
                  src={avatarUrl} 
                  fallback={userInitial} 
                  size="xl" 
                  className="bg-neutral-950 border-none font-mono"
                />
              )}

              {/* Upload overlay */}
              {!isUploading && !isLoadingProfile && (
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity duration-200">
                  <Camera className="w-6 h-6 text-white" />
                </div>
              )}

              {/* Uploading loading overlay */}
              {isUploading && (
                <div className="absolute inset-0 bg-black/75 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
                </div>
              )}
            </div>

            {/* Hidden native input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*"
              className="hidden"
              disabled={isUploading}
            />

            <span className="block text-[10px] text-center mt-2 font-semibold text-neutral-500 group-hover:text-indigo-400 transition-colors">
              Change photo
            </span>
          </div>

          {/* User metadata information */}
          <div className="flex-1 w-full space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1.5">
                Username
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-600" />
                <Input
                  type="text"
                  value={username ? `@${username}` : 'No username set'}
                  disabled
                  className="pl-10 bg-neutral-950 border-neutral-850 text-neutral-450 cursor-not-allowed select-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-600" />
                <Input
                  type="email"
                  value={userEmail}
                  disabled
                  className="pl-10 bg-neutral-950 border-neutral-850 text-neutral-450 cursor-not-allowed select-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-2">
                Account Status
              </label>
              <div className="flex items-center gap-3">
                <Badge variant={user?.email_confirmed_at ? 'success' : 'default'}>
                  {user?.email_confirmed_at ? 'Verified Account' : 'Standard'}
                </Badge>
                <div className="flex items-center gap-1.5 text-xs text-neutral-500 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Direct-to-cloud upload active</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
