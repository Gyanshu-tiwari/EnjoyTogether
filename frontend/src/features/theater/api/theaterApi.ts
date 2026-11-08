import { apiClient } from '@/shared/api/apiClient';

const TMDB_ACCESS_TOKEN = import.meta.env.VITE_TMDB_ACCESS_TOKEN;

export interface MovieMetadata {
  title: string;
  overview: string;
  bannerUrl: string;
  releaseDate: string;
}

export interface TranscodeStatus {
  status: string;
  progress: number;
  eta: string;
  speed: string;
}

export async function fetchMovieMetadata(movieName: string): Promise<MovieMetadata | null> {
  if (!movieName.trim() || !TMDB_ACCESS_TOKEN) return null;

  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(movieName)}&include_adult=false&language=en-US&page=1`,
      {
        headers: {
          Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
          accept: 'application/json',
        },
      }
    );

    const data = await response.json();
    if (!data.results || data.results.length === 0) return null;

    const primeMatch = data.results[0];
    return {
      title: primeMatch.title,
      overview: primeMatch.overview,
      bannerUrl: primeMatch.backdrop_path
        ? `https://image.tmdb.org/t/p/w1280${primeMatch.backdrop_path}`
        : 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1280',
      releaseDate: primeMatch.release_date,
    };
  } catch (error) {
    console.error('TMDB pipeline connection failed:', error);
    return null;
  }
}

export async function startUpload(fileId?: string): Promise<void> {
  await apiClient.post(`/api/video/start-upload`, fileId ? { fileId } : {});
}

export interface UploadChunkParams {
  chunk: Blob;
  fileName: string;
  fileId: string;
  chunkIndex: number;
  totalChunks: number;
  onProgress: (progressEvent: import('axios').AxiosProgressEvent) => void;
}

export async function uploadChunk({ chunk, fileName, fileId, chunkIndex, totalChunks, onProgress }: UploadChunkParams) {
  const formData = new FormData();
  formData.append('chunk', chunk);
  formData.append('name', fileName);
  formData.append('fileId', fileId);
  formData.append('chunkIndex', chunkIndex.toString());
  formData.append('totalChunks', totalChunks.toString());

  const response = await apiClient.post(`/api/video/upload-chunk`, formData, {
    onUploadProgress: onProgress,
  });

  return response.data;
}

export async function getTranscodeStatus(fileId?: string): Promise<TranscodeStatus> {
  const params = fileId ? { params: { fileId, _cb: Date.now() } } : { params: { _cb: Date.now() } };
  const response = await apiClient.get(`/api/video/transcode-status`, params);
  return response.data;
}

export interface RoomMetadataResponse {
  success: boolean;
  metadata: {
    host_id: string;
    movie_url: string;
    is_active: boolean;
  };
}

export async function getRoomMetadata(roomId: string): Promise<RoomMetadataResponse> {
  const response = await apiClient.get(`/api/rooms/${encodeURIComponent(roomId)}/metadata`);
  return response.data;
}

export async function toggleRoomActive(roomId: string, isActive: boolean): Promise<void> {
  await apiClient.post(`/api/rooms/toggle-active`, { roomId, isActive });
}

export interface RoomInvitationItem {
  id: string;
  roomId: string;
  hostId: string;
  hostName: string;
  hostAvatar?: string;
  recipientId: string;
  recipientUsername?: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  createdAt: number;
}

export async function sendRoomInvitation(params: {
  roomId: string;
  targetUserId: string;
  targetUsername?: string;
}): Promise<{ delivered: boolean; invitation: RoomInvitationItem }> {
  const response = await apiClient.post<{ data: { delivered: boolean; invitation: RoomInvitationItem } }>(
    `/api/rooms/${encodeURIComponent(params.roomId)}/invite`,
    {
      targetUserId: params.targetUserId,
      targetUsername: params.targetUsername,
    }
  );
  return response.data.data;
}

export async function getPendingRoomInvitations(): Promise<RoomInvitationItem[]> {
  const headers: Record<string, string> = {};
  if (typeof window !== 'undefined') {
    const guestId = localStorage.getItem('et_anon_user_id');
    const guestSecret = localStorage.getItem('et_anon_session_secret');
    if (guestId) headers['x-guest-id'] = guestId;
    if (guestSecret) headers['x-guest-secret'] = guestSecret;
  }
  const response = await apiClient.get<{ data: { invitations: RoomInvitationItem[] } }>(
    `/api/rooms/invitations/pending`,
    { headers }
  );
  return response.data.data?.invitations || [];
}

export async function respondToRoomInvitation(
  invitationId: string,
  response: 'accept' | 'decline'
): Promise<{ invitation: RoomInvitationItem; roomId: string }> {
  const headers: Record<string, string> = {};
  let guestId: string | undefined;
  let guestSecret: string | undefined;

  if (typeof window !== 'undefined') {
    guestId = localStorage.getItem('et_anon_user_id') || undefined;
    guestSecret = localStorage.getItem('et_anon_session_secret') || undefined;
    if (guestId) headers['x-guest-id'] = guestId;
    if (guestSecret) headers['x-guest-secret'] = guestSecret;
  }
  const res = await apiClient.post<{ data: { invitation: RoomInvitationItem; roomId: string } }>(
    `/api/rooms/invitations/${encodeURIComponent(invitationId)}/respond`,
    { response, guestId, sessionSecret: guestSecret },
    { headers }
  );
  return res.data.data;
}
