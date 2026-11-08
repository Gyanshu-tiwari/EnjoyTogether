import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Camera,
  Loader2,
  User,
  Mail,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Copy,
  Hash,
  LogOut,
  Sparkles,
} from 'lucide-react';
import { useAuthSession } from '@/features/auth';
import { Card } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';
import { Avatar } from '@/shared/components/ui/Avatar';
import { Badge } from '@/shared/components/ui/Badge';
import { supabase } from '@/shared/lib/supabase';
import { uploadAvatar, removeAvatar, updateUsername, fetchProfile } from '@/features/profile/api/profileApi';
import { getAnonymousUserId } from '@/shared/utils/anonymousUser';

export default function ProfilePage() {
  const navigate = useNavigate();
  const { session, clearGuestSession } = useAuthSession();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Profile data states
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [originalUsername, setOriginalUsername] = useState('');
  const [friendCode, setFriendCode] = useState<string | null>(null);

  // Status & feedback states
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingName, setIsSavingName] = useState(false);
  const [isRemovingAvatar, setIsRemovingAvatar] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const user = session?.user;
  const userEmail = user?.email || '';
  const guestId = (typeof window !== 'undefined' ? localStorage.getItem('et_anon_user_id') : null) || getAnonymousUserId();
  const guestSecret = typeof window !== 'undefined' ? (localStorage.getItem('et_anon_session_secret') || undefined) : undefined;

  // Revoke any temporary preview URL when unmounting or changing preview
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Load profile data on mount
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      setIsLoadingProfile(true);
      setErrorMsg(null);

      try {
        if (user?.id) {
          // Registered user profile
          const meta = user.user_metadata;
          const initialName = meta?.username || meta?.full_name || userEmail.split('@')[0] || '';
          setUsernameInput(initialName);
          setOriginalUsername(initialName);

          if (meta?.avatar_url) {
            setAvatarUrl(meta.avatar_url);
          }

          const profile = await fetchProfile();
          if (isMounted && profile) {
            if (profile.avatarUrl) setAvatarUrl(profile.avatarUrl);
            if (profile.username) {
              setUsernameInput(profile.username);
              setOriginalUsername(profile.username);
            }
            if (profile.friendCode) setFriendCode(profile.friendCode);
          }
        } else {
          // Guest session profile
          const cachedCode = typeof window !== 'undefined' ? localStorage.getItem('et_anon_friend_code') : null;
          const cachedAvatar = typeof window !== 'undefined' ? localStorage.getItem('et_anon_avatar_url') : null;

          if (cachedCode) setFriendCode(cachedCode);
          if (cachedAvatar) setAvatarUrl(cachedAvatar);

          const defaultGuestName = 'Guest User';
          setUsernameInput(defaultGuestName);
          setOriginalUsername(defaultGuestName);
        }
      } catch (err) {
        console.error('[ProfilePage] Error loading profile:', err);
      } finally {
        if (isMounted) setIsLoadingProfile(false);
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, [user, userEmail]);

  // Handle image file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMsg('Invalid file format. Please select an image file (PNG, JPG, WEBP).');
      setSuccessMsg(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg(`File size exceeds 5 MB (${(file.size / (1024 * 1024)).toFixed(2)} MB). Please select a smaller photo.`);
      setSuccessMsg(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setErrorMsg(null);
    setSuccessMsg(null);

    // Create temporary object URL for local instant preview
    if (previewUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }
    const newPreviewUrl = URL.createObjectURL(file);
    setPreviewFile(file);
    setPreviewUrl(newPreviewUrl);
  };

  // Confirm photo upload
  const handleConfirmUpload = async () => {
    if (!previewFile) return;

    setIsUploading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const uploadedUrl = await uploadAvatar(previewFile, {
        userId: user?.id,
        guestId: !user?.id ? guestId : undefined,
        sessionSecret: !user?.id ? guestSecret : undefined,
      });

      setAvatarUrl(uploadedUrl);
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
      setPreviewFile(null);
      setPreviewUrl(null);
      setSuccessMsg('Profile picture updated successfully!');
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to upload profile picture.';
      setErrorMsg(msg);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Cancel preview
  const handleCancelPreview = () => {
    if (previewUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Remove current avatar
  const handleRemoveAvatar = async () => {
    if (!avatarUrl || isRemovingAvatar || isUploading) return;

    setIsRemovingAvatar(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      await removeAvatar({
        guestId: !user?.id ? guestId : undefined,
        sessionSecret: !user?.id ? guestSecret : undefined,
      });

      setAvatarUrl(null);
      handleCancelPreview();
      setSuccessMsg('Profile picture removed.');
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to remove avatar.';
      setErrorMsg(msg);
    } finally {
      setIsRemovingAvatar(false);
    }
  };

  // Save display name changes
  const handleSaveName = async () => {
    const trimmed = usernameInput.trim();
    if (!trimmed || trimmed === originalUsername || isSavingName) return;

    setIsSavingName(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      if (user?.id) {
        await updateUsername(trimmed);
        setOriginalUsername(trimmed);
        setSuccessMsg('Display name updated successfully!');
        setTimeout(() => setSuccessMsg(null), 4000);
      } else {
        // Guest mode display name
        setOriginalUsername(trimmed);
        setSuccessMsg('Guest screen name updated for this session!');
        setTimeout(() => setSuccessMsg(null), 4000);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update username.';
      setErrorMsg(msg);
    } finally {
      setIsSavingName(false);
    }
  };

  // Cancel display name changes
  const handleCancelName = () => {
    setUsernameInput(originalUsername);
    setErrorMsg(null);
  };

  // Copy friend code
  const handleCopyCode = () => {
    if (!friendCode) return;
    navigator.clipboard.writeText(friendCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Sign out
  const handleSignOut = () => {
    clearGuestSession();
    supabase.auth.signOut();
    navigate('/');
  };

  const hasNameChanged = usernameInput.trim() !== originalUsername.trim();
  const activeAvatar = previewUrl || avatarUrl;
  const displayName = originalUsername || (user?.email?.split('@')[0]) || 'User';
  const userInitial = displayName.charAt(0).toUpperCase();

  return (
    <div className="w-full max-w-3xl mx-auto py-8 px-4 sm:px-6 animate-fade-in">
      {/* Top Navigation */}
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-white/5">
        <div className="flex items-center gap-4">
          <Button
            variant="secondary"
            className="h-10 w-10 p-0 flex items-center justify-center bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white rounded-xl transition-all cursor-pointer"
            onClick={() => navigate('/')}
            title="Return to Home"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Profile Settings</h1>
            <p className="text-xs text-neutral-400 mt-0.5">Manage your personal details, avatar, and account identity</p>
          </div>
        </div>

        {friendCode && (
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-neutral-900 border border-neutral-800 rounded-xl">
            <Hash className="w-3.5 h-3.5 text-neutral-500" />
            <span className="text-xs font-mono font-bold text-white tracking-wider">{friendCode}</span>
            <button
              onClick={handleCopyCode}
              className="text-[10px] font-semibold text-neutral-400 hover:text-white transition-colors cursor-pointer ml-1"
            >
              {copiedCode ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
      </div>

      {/* Global Alerts */}
      {successMsg && (
        <div className="mb-6 flex items-center gap-3 p-4 bg-emerald-950/40 border border-emerald-900/60 text-emerald-400 rounded-2xl text-xs font-medium animate-fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span className="flex-1">{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-neutral-400 hover:text-white text-xs font-bold">
            Dismiss
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="mb-6 flex items-center gap-3 p-4 bg-red-950/40 border border-red-900/60 text-red-400 rounded-2xl text-xs font-medium animate-fade-in">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
          <span className="flex-1">{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-neutral-400 hover:text-white text-xs font-bold">
            Dismiss
          </button>
        </div>
      )}

      <div className="space-y-6">
        {/* ── Section A: Profile Header & Avatar ──────────────────────────── */}
        <Card className="bg-[#111214] border border-white/5 rounded-[24px] p-6 sm:p-8 shadow-2xl relative overflow-hidden">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
            {/* Avatar with Upload Action */}
            <div className="relative group shrink-0">
              <div
                onClick={() => !isUploading && fileInputRef.current?.click()}
                className={`relative cursor-pointer rounded-full overflow-hidden border-2 transition-all duration-300 ${
                  isUploading
                    ? 'border-brand scale-95 opacity-80'
                    : 'border-neutral-800 hover:border-brand hover:scale-[1.02]'
                }`}
                title="Click to change photo"
              >
                {isLoadingProfile ? (
                  <div className="w-28 h-28 rounded-full bg-neutral-900 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-brand animate-spin" />
                  </div>
                ) : (
                  <Avatar
                    src={activeAvatar}
                    fallback={userInitial}
                    size="2xl"
                    className="bg-neutral-900 font-mono shadow-inner"
                  />
                )}

                {/* Hover Camera Overlay */}
                {!isUploading && !isLoadingProfile && (
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-opacity duration-200">
                    <Camera className="w-6 h-6 text-white mb-1" />
                    <span className="text-[9px] font-bold text-white uppercase tracking-wider">Change</span>
                  </div>
                )}

                {isUploading && (
                  <div className="absolute inset-0 bg-black/75 flex items-center justify-center">
                    <Loader2 className="w-7 h-7 text-brand animate-spin" />
                  </div>
                )}
              </div>

              {/* Hidden File Input */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={isUploading}
              />
            </div>

            {/* Profile Overview & Avatar Controls */}
            <div className="flex-1 text-center sm:text-left min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-1.5">
                <h2 className="text-xl font-bold text-white truncate">{displayName}</h2>
                <div>
                  {user ? (
                    <Badge variant={user.email_confirmed_at ? 'success' : 'default'} className="text-[10px]">
                      {user.email_confirmed_at ? 'Verified Account' : 'Registered User'}
                    </Badge>
                  ) : (
                    <Badge variant="warning" className="text-[10px]">
                      Guest Session
                    </Badge>
                  )}
                </div>
              </div>

              <p className="text-xs text-neutral-400 font-mono mb-4 truncate">
                {user ? userEmail : `Guest Identity #${guestId.slice(0, 14)}`}
              </p>

              {/* Preview Actions or Avatar Actions */}
              {previewFile ? (
                <div className="p-3 bg-neutral-900/90 border border-brand/30 rounded-2xl flex flex-wrap items-center gap-3 animate-fade-in">
                  <div className="flex items-center gap-2 text-xs text-brand font-semibold">
                    <Sparkles className="w-4 h-4" />
                    <span>New photo preview ready</span>
                  </div>
                  <div className="flex items-center gap-2 ml-auto">
                    <Button
                      variant="brand"
                      onClick={handleConfirmUpload}
                      disabled={isUploading}
                      className="text-xs h-8 px-4"
                    >
                      {isUploading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                          Saving...
                        </>
                      ) : (
                        'Save Photo'
                      )}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={handleCancelPreview}
                      disabled={isUploading}
                      className="text-xs h-8 px-3 bg-neutral-800 hover:bg-neutral-700"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="text-xs h-8 px-3 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-300"
                  >
                    <Camera className="w-3.5 h-3.5 mr-1.5" />
                    Upload Photo
                  </Button>
                  {avatarUrl && (
                    <Button
                      variant="secondary"
                      onClick={handleRemoveAvatar}
                      disabled={isRemovingAvatar || isUploading}
                      className="text-xs h-8 px-3 bg-red-950/20 border border-red-900/30 hover:bg-red-950/40 text-red-400"
                    >
                      {isRemovingAvatar ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                      )}
                      Remove
                    </Button>
                  )}
                  <span className="text-[11px] text-neutral-500">Max size 5 MB (PNG, JPG, WEBP)</span>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* ── Section B: Profile Information ─────────────────────────────── */}
        <Card className="bg-[#111214] border border-white/5 rounded-[24px] p-6 sm:p-8 shadow-2xl">
          <div className="mb-6 pb-4 border-b border-white/5">
            <h3 className="text-base font-bold text-white">Profile Information</h3>
            <p className="text-xs text-neutral-400 mt-0.5">Customize your public display name</p>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="display-name-input" className="block text-[11px] font-bold text-neutral-400 uppercase tracking-wider mb-2">
                Display Name / Username
              </label>
              <div className="relative max-w-lg">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <Input
                  id="display-name-input"
                  type="text"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  placeholder="Enter your display name"
                  maxLength={50}
                  disabled={isLoadingProfile || isSavingName}
                  className="pl-10 bg-neutral-900 border-neutral-800 text-white focus:border-brand h-11 text-sm rounded-xl"
                />
              </div>
              <p className="text-[11px] text-neutral-500 mt-1.5">
                This name is displayed to other participants in watch party rooms and friend lists.
              </p>
            </div>

            {/* Explicit Save & Cancel Controls */}
            <div className="flex items-center gap-3 pt-2">
              <Button
                variant="brand"
                onClick={handleSaveName}
                disabled={!hasNameChanged || isSavingName || !usernameInput.trim()}
                className="text-xs h-9 px-5 font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSavingName ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
              <Button
                variant="secondary"
                onClick={handleCancelName}
                disabled={!hasNameChanged || isSavingName}
                className="text-xs h-9 px-4 bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </Button>
            </div>
          </div>
        </Card>

        {/* ── Section C: Account Information & Security ──────────────────── */}
        <Card className="bg-[#111214] border border-white/5 rounded-[24px] p-6 sm:p-8 shadow-2xl">
          <div className="mb-6 pb-4 border-b border-white/5">
            <h3 className="text-base font-bold text-white">Account Details</h3>
            <p className="text-xs text-neutral-400 mt-0.5">Authentication identities and security identifiers</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {/* Account Type */}
            <div className="p-4 bg-neutral-900/60 border border-neutral-800/80 rounded-2xl">
              <span className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">
                Account Type
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white">
                  {user ? 'Registered SaaS Account' : 'Ephemeral Guest Identity'}
                </span>
              </div>
              <span className="block text-[11px] text-neutral-500 mt-1">
                {user ? 'Cloud-synchronized with persistent auth' : 'Active during this browser session'}
              </span>
            </div>

            {/* Friend Code */}
            <div className="p-4 bg-neutral-900/60 border border-neutral-800/80 rounded-2xl">
              <span className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">
                Authoritative Friend Code
              </span>
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono font-bold text-white tracking-widest">
                  {friendCode ? `${friendCode.slice(0, 3)} ${friendCode.slice(3, 6)}` : '------'}
                </span>
                {friendCode && (
                  <button
                    onClick={handleCopyCode}
                    className="text-xs font-semibold text-brand hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    {copiedCode ? 'Copied!' : 'Copy Code'}
                  </button>
                )}
              </div>
              <span className="block text-[11px] text-neutral-500 mt-1">
                Used to find and connect with friends across rooms
              </span>
            </div>

            {/* Email Address */}
            <div className="p-4 bg-neutral-900/60 border border-neutral-800/80 rounded-2xl">
              <span className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">
                Email Address
              </span>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-neutral-500 shrink-0" />
                <span className="text-sm font-medium text-white truncate">
                  {user ? userEmail : 'No email associated (Guest)'}
                </span>
              </div>
              <span className="block text-[11px] text-neutral-500 mt-1">
                {user ? 'Primary credential for login and recovery' : 'Upgrade to registered account to link email'}
              </span>
            </div>

            {/* Storage Architecture */}
            <div className="p-4 bg-neutral-900/60 border border-neutral-800/80 rounded-2xl">
              <span className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">
                Avatar Cloud Storage
              </span>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-sm font-medium text-white">Supabase Storage CDN</span>
              </div>
              <span className="block text-[11px] text-neutral-500 mt-1">
                End-to-end server validated WebP asset delivery
              </span>
            </div>
          </div>

          {/* Authentication Sensitive Actions */}
          <div className="pt-4 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-white">Session Security</p>
              <p className="text-[11px] text-neutral-500">Sign out of your active session on this device</p>
            </div>
            <Button
              variant="secondary"
              onClick={handleSignOut}
              className="w-full sm:w-auto text-xs px-4 py-2 bg-red-950/20 border border-red-900/30 text-red-400 hover:bg-red-950/40 rounded-xl font-semibold transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{user ? 'Sign Out of Account' : 'Clear Guest Session'}</span>
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
