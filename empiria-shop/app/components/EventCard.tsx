import Link from 'next/link';
import { MapPin, Ticket, ImageIcon } from 'lucide-react';

export interface EventCardProps {
    id: string;
    title: string;
    slug: string;
    coverImageUrl?: string;
    venueName?: string;
    city?: string;
    category?: string;
    eventType?: string;
    startAt?: string;
    minPrice: number;
    currencySymbol: string;
    attendeesCount?: number;
    attendeeAvatars?: string[];
}

export function EventCard({
    id,
    title,
    slug,
    coverImageUrl,
    venueName,
    city,
    category,
    eventType = 'In-Person',
    startAt,
    minPrice,
    currencySymbol,
    attendeesCount = 0,
    attendeeAvatars = [],
}: EventCardProps) {
    const eventDate = startAt ? new Date(startAt) : null;
    const month = eventDate?.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    const day = eventDate?.getDate();
    const dayName = eventDate?.toLocaleDateString('en-US', { weekday: 'short' });
    const time = eventDate?.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    const isFree = minPrice === 0;

    return (
        <Link href={`/events/${slug}`} className="group block h-full">
            <div className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 h-full flex flex-col">
                {/* Image Section */}
                <div className="aspect-[4/3] bg-[#FEF3E7] relative overflow-hidden">
                    {coverImageUrl ? (
                        <img
                            src={coverImageUrl}
                            alt={title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center">
                            <div className="w-16 h-16 border-2 border-[#F98C1F] rounded-lg flex items-center justify-center">
                                <ImageIcon className="w-8 h-8 text-[#F98C1F]" />
                            </div>
                        </div>
                    )}

                    {/* Event Type Badge */}
                    <div className="absolute top-3 left-3">
                        <span className="bg-[#1a1a1a] text-white text-xs font-medium px-3 py-1.5 rounded-full z-10">
                            {eventType}
                        </span>
                    </div>

                    {/* Category Badge */}
                    {category && (
                        <div className="absolute bottom-3 left-3">
                            <span className="bg-[#F98C1F] text-white text-xs font-bold px-3 py-1 rounded-md shadow-sm z-10 uppercase tracking-wider">
                                {category}
                            </span>
                        </div>
                    )}
                </div>

                {/* Content Section */}
                <div className="p-5 flex flex-col flex-1">
                    {/* Date and Title Row */}
                    <div className="flex items-start gap-4 mb-4 mt-1">
                        {/* Date Box */}
                        {eventDate ? (
                            <div className="flex-shrink-0 border border-gray-200 rounded-lg px-3 py-2 text-center min-w-[56px] shadow-[0_2px_8px_-4px_rgba(0,0,0,0.1)]">
                                <span className="block text-[#F98C1F] text-[10px] font-bold uppercase tracking-widest">{month}</span>
                                <span className="block text-slate-900 text-xl font-extrabold leading-tight mt-0.5">{day}</span>
                            </div>
                        ) : (
                            <div className="flex-shrink-0 border border-gray-200 rounded-lg px-3 py-2 text-center min-w-[56px] shadow-sm flex items-center justify-center">
                                <span className="block text-gray-400 text-xs font-bold uppercase">TBD</span>
                            </div>
                        )}

                        {/* Title and Time */}
                        <div className="flex-1 min-w-0 flex flex-col h-full pt-0.5">
                            <h3 className="font-bold text-[17px] text-slate-900 leading-tight group-hover:text-[#F98C1F] transition-colors line-clamp-2">
                                {title}
                            </h3>
                            {eventDate && (
                                <p className="text-[#F98C1F] text-[13px] font-semibold mt-1.5 flex items-center">
                                    {dayName}, {time}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Location */}
                    <div className="flex items-center gap-2 text-sm text-gray-500 mb-4 mt-auto">
                        <MapPin className="w-[15px] h-[15px] text-gray-400 flex-shrink-0" />
                        <span className="line-clamp-1 text-[13px]">{city}{venueName ? `, ${venueName}` : ''}</span>
                    </div>

                    {/* Tickets Info */}
                    <div className="flex items-center justify-between text-[13px] mb-4">
                        <div className="flex items-center gap-2 text-gray-500">
                            <Ticket className="w-[15px] h-[15px] text-gray-400 flex-shrink-0" />
                            <span>{isFree ? 'Free entry' : 'Tickets from'}</span>
                        </div>
                        <span className="font-bold text-slate-900 text-[15px]">
                            {isFree ? 'Free' : `${currencySymbol}${minPrice.toLocaleString()}`}
                        </span>
                    </div>

                    {/* Divider */}
                    <div className="border-t border-gray-100 my-0 mb-4" />

                    {/* Footer */}
                    <div className="flex items-center justify-between mt-auto">
                        {/* Attendee Avatars */}
                        <div className="flex items-center">
                            <div className="flex -space-x-1.5">
                                {attendeeAvatars.length > 0 ? (
                                    attendeeAvatars.slice(0, 2).map((avatar, idx) => (
                                        <div
                                            key={idx}
                                            className="w-7 h-7 rounded-full border-[1.5px] border-white overflow-hidden bg-gray-100"
                                        >
                                            <img src={avatar} alt="" className="w-full h-full object-cover" />
                                        </div>
                                    ))
                                ) : (
                                    <>
                                        <div className="w-7 h-7 rounded-full border-[1.5px] border-white bg-emerald-500 shadow-sm" />
                                        <div className="w-7 h-7 rounded-full border-[1.5px] border-white bg-blue-500 shadow-sm" />
                                        <div className="w-7 h-7 rounded-full border-[1.5px] border-white bg-amber-500 shadow-sm" />
                                    </>
                                )}
                            </div>
                            {attendeesCount > 0 ? (
                                <span className="ml-[10px] text-[12px] text-gray-500 font-medium">
                                    +{attendeesCount}
                                </span>
                            ) : (
                                <span className="ml-[10px] text-[12px] text-gray-500 font-medium">
                                    +42
                                </span>
                            )}
                        </div>

                        {/* View Details Link */}
                        <span className="text-[#F98C1F] font-bold text-[13px] group-hover:underline">
                            Get Tickets
                        </span>
                    </div>
                </div>
            </div>
        </Link>
    );
}
