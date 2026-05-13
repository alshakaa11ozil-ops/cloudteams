// src/pages/CreateTeam.tsx
//
// PURPOSE: Form to create a new team.
//          Validates with Zod, submits with React Query mutation,
//          invalidates the teams cache on success, navigates back to /teams.
//
// INPUTS:  None
// OUTPUTS: A create team form page

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createTeam } from '@/api/teams'

// ─── 1. ZOD SCHEMA ─────────────────────────────────────────────────────────

const createTeamSchema = z.object({
    name: z
        .string()
        .min(2, 'Team name must be at least 2 characters')
        .max(50, 'Team name must be under 50 characters')
        .trim(),  // strip leading/trailing whitespace before validation
    // WHY: "  " (spaces only) would pass min(2) without trim()

    description: z
        .string()
        .max(200, 'Description must be under 200 characters')
        .trim()
        // optional() means the field can be an empty string or omitted entirely
        // WHY: description is not required — teams can exist without one
        .optional(),
})

type CreateTeamFormData = z.infer<typeof createTeamSchema>

// ─── 2. THE COMPONENT ──────────────────────────────────────────────────────

export default function CreateTeam() {
    const navigate = useNavigate()

    // useQueryClient() gives us access to the React Query cache.
    // We use it after a successful mutation to invalidate the teams list.
    // WHY: Without invalidation, TeamList would still show old cached data
    // and the new team wouldn't appear until the staleTime expires.
    const queryClient = useQueryClient()

    const [serverError, setServerError] = useState<string | null>(null)

    // ── React Hook Form setup ─────────────────────────────────────────────────

    const {
        register,
        handleSubmit,
        watch,            // watch() reads a field's current value without submitting
        // We use it to show the character count for description
        formState: { errors },
    } = useForm<CreateTeamFormData>({
        resolver: zodResolver(createTeamSchema),
        defaultValues: {
            name: '',
            description: '',
        },
    })

    // Watch description length for the character counter
    // watch('description') re-renders the component when description changes.
    // WHY: Shows live feedback "45/200" so users know their limit.
    const descriptionValue = watch('description') ?? ''

    // ── React Query mutation ──────────────────────────────────────────────────
    //
    // useMutation wraps our createTeam API call.
    // Unlike useQuery, mutations don't run automatically —
    // they run when we call mutate() or mutateAsync().

    const mutation = useMutation({
        // mutationFn: the async function to call when mutate() is triggered.
        // It receives the form data and calls our API function.
        mutationFn: (data: CreateTeamFormData) =>
            createTeam({
                name: data.name,
                // Only send description if it's non-empty.
                // WHY: Sending description: "" to the backend is different from
                // not sending it at all. Backend may store "" as a value vs null.
                description: data.description?.trim() || undefined,
            }),

        // onSuccess runs AFTER the mutation succeeds.
        // `newTeam` is the Team object returned by the backend.
        onSuccess: (newTeam) => {
            // Invalidate the teams cache — forces TeamList to re-fetch.
            // The user will see their new team immediately when redirected.
            void queryClient.invalidateQueries({ queryKey: ['teams'] })

            // Navigate to the new team's dashboard.
            // replace: true so back button goes to /teams, not back to this form.
            navigate(`/teams/${newTeam.id}`, { replace: true })
        },

        // onError runs if the API call throws.
        // We extract the backend error message here instead of in try/catch.
        onError: (err: unknown) => {
            if (
                err &&
                typeof err === 'object' &&
                'response' in err &&
                err.response &&
                typeof err.response === 'object' &&
                'data' in err.response
            ) {
                const data = err.response.data as { error?: string }
                setServerError(data.error ?? 'Failed to create team. Please try again.')
            } else {
                setServerError('Cannot reach the server. Check your connection.')
            }
        },
    })

    // ── Submit handler ────────────────────────────────────────────────────────
    //
    // Called by React Hook Form AFTER Zod validation passes.
    // Simply triggers the mutation — all success/error handling is in useMutation.

    const onSubmit = (data: CreateTeamFormData) => {
        setServerError(null)
        mutation.mutate(data)
    }

    // ─── 3. RENDER ─────────────────────────────────────────────────────────

    return (
        <div className="p-6 max-w-2xl mx-auto">

            {/* Page header with back button */}
            <div className="mb-8">
                <button
                    onClick={() => navigate('/teams')}
                    className="
            inline-flex items-center gap-1.5 text-sm text-gray-500
            hover:text-gray-900 transition-colors mb-4
          "
                >
                    {/* Left arrow icon */}
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M10 19l-7-7m0 0l7-7m-7 7h18"
                        />
                    </svg>
                    Back to teams
                </button>

                <h1 className="text-2xl font-semibold text-gray-900">
                    Create a new team
                </h1>
                <p className="text-sm text-gray-500 mt-1">
                    Set up a shared workspace for your group to collaborate and share files.
                </p>
            </div>

            {/* Form card */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">

                {/* Server error banner */}
                {serverError && (
                    <div className="mb-6 px-4 py-3 rounded-lg bg-red-50 border border-red-200">
                        <p className="text-sm text-red-700">{serverError}</p>
                    </div>
                )}

                <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">

                    {/* ── Team name ───────────────────────────────────────────────── */}
                    <div>
                        <label
                            htmlFor="name"
                            className="block text-sm font-medium text-gray-700 mb-1"
                        >
                            Team name
                            {/* Red asterisk indicates required field */}
                            <span className="text-red-500 ml-1" aria-label="required">*</span>
                        </label>
                        <input
                            id="name"
                            type="text"
                            {...register('name')}
                            placeholder="e.g. CS 101 Project, Marketing Team"
                            autoComplete="off"
                            autoFocus
                            className={`
                w-full px-3 py-2 rounded-lg border text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                transition-colors
                ${errors.name
                                    ? 'border-red-400 bg-red-50'
                                    : 'border-gray-300 bg-white'
                                }
              `}
                        />
                        {errors.name && (
                            <p className="mt-1 text-xs text-red-600">
                                {errors.name.message}
                            </p>
                        )}
                    </div>

                    {/* ── Description ─────────────────────────────────────────────── */}
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label
                                htmlFor="description"
                                className="block text-sm font-medium text-gray-700"
                            >
                                Description
                                <span className="text-gray-400 font-normal ml-1">(optional)</span>
                            </label>
                            {/* Live character counter */}
                            <span className={`text-xs ${descriptionValue.length > 180
                                    ? 'text-red-500'      // warn when close to limit
                                    : 'text-gray-400'
                                }`}>
                                {descriptionValue.length}/200
                            </span>
                        </div>
                        <textarea
                            id="description"
                            {...register('description')}
                            placeholder="What is this team working on?"
                            rows={3}
                            className={`
                w-full px-3 py-2 rounded-lg border text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                transition-colors resize-none
                ${errors.description
                                    ? 'border-red-400 bg-red-50'
                                    : 'border-gray-300 bg-white'
                                }
              `}
                        />
                        {errors.description && (
                            <p className="mt-1 text-xs text-red-600">
                                {errors.description.message}
                            </p>
                        )}
                    </div>

                    {/* ── What happens next info box ───────────────────────────────── */}
                    <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
                        <p className="text-xs font-medium text-blue-700 mb-1">
                            After creating your team you can:
                        </p>
                        <ul className="text-xs text-blue-600 space-y-0.5">
                            <li>• Invite members by email</li>
                            <li>• Upload and share files</li>
                            <li>• Set roles — viewer, editor, or admin</li>
                        </ul>
                    </div>

                    {/* ── Action buttons ───────────────────────────────────────────── */}
                    <div className="flex items-center gap-3 pt-2">
                        <button
                            type="submit"
                            // mutation.isPending is true while the API call is in flight.
                            // React Hook Form's isSubmitting is for sync validation only —
                            // for async mutations we use mutation.isPending instead.
                            disabled={mutation.isPending}
                            className="
                flex-1 py-2.5 px-4 rounded-lg text-sm font-medium
                bg-blue-600 text-white
                hover:bg-blue-700
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-colors
              "
                        >
                            {mutation.isPending ? (
                                // Loading state with spinning indicator
                                <span className="inline-flex items-center gap-2">
                                    {/* Simple CSS spinner — no library needed */}
                                    <svg
                                        className="animate-spin h-4 w-4"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                    >
                                        <circle
                                            className="opacity-25"
                                            cx="12" cy="12" r="10"
                                            stroke="currentColor"
                                            strokeWidth="4"
                                        />
                                        <path
                                            className="opacity-75"
                                            fill="currentColor"
                                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                                        />
                                    </svg>
                                    Creating team...
                                </span>
                            ) : (
                                'Create team'
                            )}
                        </button>

                        {/* Cancel — goes back without creating */}
                        <button
                            type="button"
                            onClick={() => navigate('/teams')}
                            disabled={mutation.isPending}
                            className="
                px-4 py-2.5 rounded-lg text-sm font-medium
                text-gray-700 bg-white border border-gray-300
                hover:bg-gray-50
                focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-colors
              "
                        >
                            Cancel
                        </button>
                    </div>

                </form>
            </div>
        </div>
    )
}