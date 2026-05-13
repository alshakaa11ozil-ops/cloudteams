import axios from 'axios'

// ─── PUBLIC AXIOS CONFIGURATION ─────────────────────────────────────────────
// PURPOSE: Dedicated Axios instance for public routes (e.g. Shared Links)
// WHY: We do NOT want to attach the Authorization header or automatically
//      redirect to /login on 401s for public pages.

const publicApi = axios.create({
    baseURL: import.meta.env.VITE_API_URL ?? '/api'
})

// Optional: Add global error handling similar to authenticated axios,
// but without the 401 redirect logic.
publicApi.interceptors.response.use(
    (response) => response,
    (error) => {
        // If the error response is present and has a status and data
        if (error.response) {
            console.error('[publicApi Error]', error.response.status, error.response.data)
        }
        return Promise.reject(error)
    }
)

export default publicApi
