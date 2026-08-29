# Landing Page Analysis

## Existing Product Analysis
* **What the existing product does**: "EnjoyTogether" is a "Google Meet style movie streaming room." It allows users to watch videos together in sync. A host creates a room, and guests can join by knocking. 
* **Target users**: Friends, couples, families, and remote teams who want to watch media together in a synchronized environment with communication features.
* **Main value proposition**: Seamless, synchronized video playback combined with real-time social interaction (audio/video, floating emojis).
* **Existing features**:
  * Authentication (Supabase)
  * Dynamic Room Creation (UploadDashboard)
  * Host/Guest Roles & Permissions (Knocking / Approving)
  * Theater View (synced playback)
  * Pre-join Lobby (Camera/Mic checks)
  * Real-time floating emojis
  * Invite links & copying
* **Existing user journeys**:
  1. *Host*: Logs in -> Lands on Dashboard -> Pastes Video URL -> Starts Session -> Approves Guests.
  2. *Guest*: Clicks invite link -> Authenticates (if required) -> Lands in Lobby -> Requests to Join -> Enters Theater.
* **Existing brand identity**:
  * **Name**: EnjoyTogether
  * **Colors**: Indigo primary (`#4F46E5`), dark backgrounds (`#09090B`, `#18181B`).
  * **Tone**: Modern, sleek, social, easy-to-use.
* **Existing visual language**:
  * Deep dark mode (high contrast).
  * Rounded cards and buttons (`--radius-2xl`, `--radius-3xl`).
  * Subtle borders and glowing accents (`--color-border-subtle`).
  * Shimmer effects, GPU transitions, fade/slide animations.
  * Fonts: *Nunito* for headings, *Inter* for body.
* **Existing reusable components**:
  * UI: `Button`, `Avatar`
  * Layout: `MainLayout`, `Header`
  * Feedback: `TheaterSkeleton`, `DashboardSkeleton`, `LobbySkeleton`
* **Existing routes**:
  * `/` -> Renders `Room` (which shows `UploadDashboard` if no ID, or `LoginForm` if unauthenticated).
  * `/room/:id` -> Theater/Lobby view.
  * `/profile`, `/reset-password`, `/verified` -> Auth/User flows.
* **Existing assets**: Uses `lucide-react` for icons.

## Recommended Architecture & Landing Page Strategy
* **Route Structure**: 
  * Make `/` the public `LandingPage`. 
  * Move the current `UploadDashboard` (Room without ID) to `/app` or `/dashboard`.
  * If a user visits `/` and is already authenticated, they can see a "Go to Dashboard" button in the Hero CTA, or auto-redirect.
* **Section Mapping**:
  1. **Navbar**: Brand + Login CTA (leading to `/login` or `/app`).
  2. **Hero**: Headline ("Watch Together, Anywhere"). CTA: "Start a Watch Party". Visual: High-fidelity mockup of the Theater View + Floating Emojis.
  3. **Social Proof / Trust**: "Join thousands of watch parties" (keep abstract if no real stats exist, or omit if not applicable).
  4. **How It Works**: 3 steps: Create Room -> Invite Friends -> Grab Popcorn.
  5. **Product Showcase**: Large UI mockup of the Lobby (camera/mic checks) and host approval flow.
  6. **Feature Deep-Dive**: Synced playback, real-time chat/emojis, host controls.
  7. **FAQ**: "Is it free?", "Do my friends need an account?", etc.
  8. **Final CTA**: "Ready to start your next movie night?"

## Draftr Design Patterns
* **Worth Adapting**:
  * Large, confident typography scale for headings (using `Nunito`).
  * Pill-shaped badges (eyebrows) above headings.
  * Floating, layered mockups of the UI with subtle glow behind them.
  * "Card-based" feature grids with glassmorphism (matches existing `--color-bg-card`).
  * Alternating left-text/right-visual deep dive sections.
  * Smooth fade-up scroll reveals (using intersection observers or existing animations).
* **Should NOT be Copied**:
  * Developer/designer-specific copy (e.g., "Revolutionize your workflow").
  * Pricing section (EnjoyTogether appears to be free/open).
  * Fake testimonials (use a placeholder block if needed, or omit).
  * Integrations section (unless it integrates with specific video platforms, but it seems to just take generic URLs).
