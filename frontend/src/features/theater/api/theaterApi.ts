import axios from 'axios';

const TMDB_ACCESS_TOKEN = import.meta.env.VITE_TMDB_ACCESS_TOKEN;

// Computed lazily per-call so hot reloads and network changes always resolve the
// correct backend address rather than locking to the value at first module import.
function getBackendUrl(): string {
  return import.meta.env.VITE_BACKEND_URL
    || `http://${window.location.hostname}:5000`;
}

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

export async function startUpload(): Promise<void> {
  await axios.post(`${getBackendUrl()}/api/video/start-upload`);
}

export interface UploadChunkParams {
  file: File;
  onProgress: (progressEvent: import('axios').AxiosProgressEvent) => void;
}

export async function uploadChunk({ file, onProgress }: UploadChunkParams) {
  const formData = new FormData();
  formData.append('chunk', file);
  formData.append('name', file.name);

  const response = await axios.post(`${getBackendUrl()}/api/video/upload-chunk`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    onUploadProgress: onProgress,
  });

  return response.data;
}

export async function getTranscodeStatus(): Promise<TranscodeStatus> {
  const response = await axios.get(`${getBackendUrl()}/api/video/transcode-status`);
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
  const response = await axios.get(`${getBackendUrl()}/api/rooms/${encodeURIComponent(roomId)}/metadata`);
  return response.data;
}

export async function toggleRoomActive(roomId: string, isActive: boolean): Promise<void> {
  await axios.post(`${getBackendUrl()}/api/rooms/toggle-active`, { roomId, isActive });
}
