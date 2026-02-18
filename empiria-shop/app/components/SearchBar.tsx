'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, MapPin } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { searchEvents, type SearchResult } from '@/app/actions/searchEvents';

export default function SearchBar() {
    const router = useRouter();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Debounce search
    useEffect(() => {
        const delayDebounceFn = setTimeout(async () => {
            if (query.length >= 2) {
                setIsLoading(true);
                const data = await searchEvents(query);
                setResults(data);
                setIsLoading(false);
                setIsOpen(true);
            } else {
                setResults([]);
                setIsOpen(false);
            }
        }, 300);

        return () => clearTimeout(delayDebounceFn);
    }, [query]);

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (slug: string) => {
        router.push(`/events/${slug}`);
        setIsOpen(false);
    };

    const handleSearchClick = () => {
        if (query) {
            // Optional: Implement full search page navigation if needed
            console.log('Searching for:', query);
        }
    };


    return (
        <div ref={wrapperRef} className="relative w-full max-w-3xl mx-auto z-50">
            <div className="bg-white p-2 rounded-full shadow-xl border border-gray-200 flex flex-col sm:flex-row gap-2 relative z-20">

                {/* Event Search Input */}
                <div className="flex-1 flex items-center px-4 h-12 bg-gray-50 sm:bg-transparent rounded-full sm:rounded-none">
                    <Search className="text-gray-400 w-5 h-5 mr-3 shrink-0" />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onFocus={() => { if (results.length > 0) setIsOpen(true); }}
                        placeholder="Search events, artists, categories..."
                        className="bg-transparent w-full outline-none text-sm font-medium placeholder:text-gray-400"
                    />
                </div>

                <div className="hidden sm:block w-px bg-gray-200 h-8 self-center"></div>

                {/* Location Input (Visual mostly, but could refine filter later) */}
                <div className="flex-1 flex items-center px-4 h-12 bg-gray-50 sm:bg-transparent rounded-full sm:rounded-none">
                    <MapPin className="text-gray-400 w-5 h-5 mr-3 shrink-0" />
                    <input
                        type="text"
                        placeholder="City or Location"
                        className="bg-transparent w-full outline-none text-sm font-medium placeholder:text-gray-400"
                    />
                </div>

                {/* Search Button */}
                <button
                    onClick={handleSearchClick}
                    className="bg-orange-600 text-white h-12 px-8 rounded-full font-bold hover:bg-orange-700 transition-colors shrink-0"
                >
                    Search
                </button>
            </div>

            {/* Dropdown Results */}
            {isOpen && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden max-h-96 overflow-y-auto z-10 p-2">
                    {isLoading ? (
                        <div className="p-4 text-center text-gray-500 text-sm">Loading...</div>
                    ) : results.length > 0 ? (
                        <ul>
                            {results.map((event) => (
                                <li key={event.id}>
                                    <button
                                        onClick={() => handleSelect(event.slug)}
                                        className="w-full text-left p-3 hover:bg-orange-50 rounded-xl transition-colors flex items-center gap-3 group"
                                    >
                                        <div className="bg-orange-100 text-orange-600 p-2 rounded-lg group-hover:bg-orange-200 transition-colors">
                                            <Search size={18} />
                                        </div>
                                        <div>
                                            <div className="font-bold text-slate-900">{event.title}</div>
                                            <div className="text-xs text-gray-500 flex items-center gap-1">
                                                <span>{event.city}</span>
                                                <span>•</span>
                                                <span>{new Date(event.start_at).toLocaleDateString()}</span>
                                            </div>
                                        </div>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="p-4 text-center text-gray-500 text-sm">
                            No results found for "{query}"
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
