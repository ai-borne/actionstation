/**
 * Landing Page — All string resources for the public landing page.
 * SSOT for copy across hero, features, pricing, FAQ, nav, and footer.
 */

export const landingStrings = {
    nav: {
        features: 'Features',
        pricing: 'Pricing',
        faq: 'FAQ',
        login: 'Sign In',
        getStarted: 'Get Started Free',
        ariaLabel: 'Main navigation',
        mobileAriaLabel: 'Mobile navigation',
        openMenu: 'Open navigation menu',
        closeMenu: 'Close navigation menu',
        menuOpenIcon: '☰',
        menuCloseIcon: '✕',
    },
    hero: {
        title: 'Your best ideas don\u2019t live in a list.',
        subtitle:
            'ActionStation is an infinite canvas where you capture ideas, draw connections, and let AI synthesize them into insights.',
        ctaPrimary: 'Get Started Free',
        ctaSecondary: 'See how it works',
        /** Label for the synthesis output node in the hero animation. */
        synthNodeLabel: 'Insights',
        /** Accessible label for the hero animation SVG. */
        animationAriaLabel: 'Animated canvas demo',
        /** Icon prefix for the synthesis output node. */
        synthNodeIcon: '\u2726 ',
    },
    features: {
        sectionTitle: 'Everything you need to think clearly',
        canvas: {
            title: 'Infinite Canvas',
            description:
                'Drag, zoom, and arrange ideas freely in a boundless workspace.',
        },
        ai: {
            title: 'AI Synthesis',
            description:
                'Let AI find patterns across your ideas and generate actionable insights.',
        },
        knowledgeBank: {
            title: 'Knowledge Bank',
            description:
                'Build persistent context that grows smarter with every session.',
        },
        contextChains: {
            title: 'Context Chains',
            description:
                'Connect nodes into reasoning threads that reveal hidden structure.',
        },
        search: {
            title: 'Instant Search',
            description:
                'Find any idea across all workspaces with full-text search.',
        },
        offline: {
            title: 'Offline Ready',
            description:
                'Pin workspaces for offline access. Changes sync automatically.',
        },
    },
    howItWorks: {
        sectionTitle: 'How it works',
        steps: [
            {
                title: 'Capture',
                description: 'Drop ideas as nodes on your canvas \u2014 text, AI prompts, or images.',
            },
            {
                title: 'Connect',
                description: 'Draw edges between related ideas to build structure.',
            },
            {
                title: 'Synthesize',
                description: 'Let AI analyze your connections and surface new insights.',
            },
        ] as const,
    },
    pricing: {
        sectionTitle: 'Simple, transparent pricing',
        sectionSubtitle: 'Start free. Upgrade when you need more.',
        freePlanName: 'Free',
        proPlanName: 'Pro',
        freePrice: '$0',
        proPrice: '\u20B92,999/yr',
        proPriceNote: 'Annual plan — billed once per year',
        freeCta: 'Get Started',
        proCta: 'Upgrade to Pro',
        proBadge: 'Most Popular',
        labels: {
            workspaces: 'Workspaces',
            nodesPerWorkspace: 'Nodes per workspace',
            aiGenerationsPerDay: 'AI generations / day',
            storage: 'Storage',
        },
        unlimited: 'Unlimited',
        generousLimits: 'Generous limits',
    },
    faq: {
        sectionTitle: 'Frequently asked questions',
        items: [
            {
                question: 'What is ActionStation?',
                answer: 'ActionStation is an AI-powered infinite canvas for capturing, connecting, and synthesizing ideas. Think of it as a visual second brain.',
            },
            {
                question: 'Is my data private?',
                answer: 'Yes. Your data is stored securely in Firebase with per-user access controls. We never share or sell your data.',
            },
            {
                question: 'What AI model do you use?',
                answer: 'We use Google Gemini via a server-side proxy. Your prompts are never stored by us beyond the generation request.',
            },
            {
                question: 'Can I use it offline?',
                answer: 'Pro subscribers can pin workspaces for offline access. Changes sync automatically when you reconnect.',
            },
            {
                question: 'How do I cancel my subscription?',
                answer: 'Pro is an annual plan in India. Email support@actionstation.in for billing help or refund requests. You keep Pro access until your plan expires.',
            },
            {
                question: 'Can I export my data?',
                answer: 'Yes. Export any workspace as Markdown or as a structured branch view at any time.',
            },
            {
                question: 'What happens when I hit the free tier limit?',
                answer: 'You\u2019ll see a prompt to upgrade. Your existing data is never deleted \u2014 you just can\u2019t create new items until you upgrade or free up space.',
            },
        ] as const,
    },
    footer: {
        tagline: 'Think visually. Connect ideas.',
        copyright: (year: number) => `\u00A9 ${year} ActionStation. All rights reserved.`,
        terms: 'Terms of Service',
        privacy: 'Privacy Policy',
        contact: 'Contact',
    },
} as const;
