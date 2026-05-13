// frontend/src/components/UserAvatar.tsx
//
// PURPOSE: Consistent user avatar across the entire app.
//          Shows colored circle with initials.
//          Used in sidebar, member lists, comments, activity feed.
//
// WHY INITIALS NOT PHOTO: No file storage, no image processing,
//   works for every user instantly on registration.
//   Professional tools like Notion and Linear use this by default.

import { getAvatarColor, getInitials } from '@/utils/avatarColor'

interface UserAvatarProps {
    userId: number
    username: string
    fullName?: string | null
    size?: 'xs' | 'sm' | 'md' | 'lg'
    className?: string
}

const SIZE_CLASSES = {
    xs: 'w-6 h-6 text-xs',
    sm: 'w-8 h-8 text-sm',
    md: 'w-10 h-10 text-base',
    lg: 'w-12 h-12 text-lg',
}

export default function UserAvatar({
    userId,
    username,
    fullName,
    size = 'sm',
    className = '',
}: UserAvatarProps) {
    const color = getAvatarColor(userId)
    const initials = getInitials(fullName ?? null, username)

    return (
        <div
            className={`
        ${SIZE_CLASSES[size]}
        rounded-full flex items-center justify-center
        flex-shrink-0 font-bold text-white select-none
        ${className}
      `}
            style={{ backgroundColor: color }}
            title={fullName ?? username}
        >
            {initials}
        </div>
    )
}