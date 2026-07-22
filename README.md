# ALZA Flow

A modern SaaS agency management platform built for **ALZA Business Solutions**.

## Tech Stack

- **React 19** + **TypeScript**
- **Vite** — fast dev server and build tooling
- **Tailwind CSS v4** — utility-first styling with ALZA blue/teal theme
- **React Router v7** — client-side routing
- **Supabase** — backend and authentication (configured via env vars)
- **React Hook Form** — form state management
- **TanStack Table** — data tables
- **Recharts** — charts and analytics
- **Lucide React** — icon library

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ (LTS recommended)

### Install & Run

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Environment Variables

Copy the example env file and add your Supabase credentials:

```bash
cp .env.example .env
```

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## Project Structure

```
src/
├── components/
│   ├── dashboard/     # Dashboard widgets (StatCard, RevenueChart, etc.)
│   └── layout/        # App shell (Sidebar, Header, AppLayout)
├── lib/
│   └── supabase.ts    # Supabase client
├── pages/
│   ├── admin/         # Administration pages
│   └── ...            # Main navigation pages
├── types/             # Shared TypeScript types
├── App.tsx            # Route definitions
└── main.tsx           # App entry point
```

## Navigation

| Section | Pages |
|---------|-------|
| Main | Dashboard, Clients, Policy Files, Transactions, Financials, Reports |
| Administration | Producers, CSRs, MGAs, Carriers, Users |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview production build |
| `npm run lint` | Run ESLint |

## Brand Colors

The UI uses ALZA Business Solutions brand colors:

- **Blue** — `#1e40af` → `#2563eb`
- **Teal** — `#0d9488` → `#14b8a6`

These are defined as custom Tailwind tokens (`alza-blue-*`, `alza-teal-*`).

---

Built with ❤️ by ALZA Business Solutions
