import { Navigate, Route, Routes } from "react-router-dom";

import Layout from "./components/Layout";
import NotFound from "./pages/NotFound";
import PublicCalendar from "./pages/PublicCalendar";
import EventDetail from "./pages/EventDetail";

export default function App() {
    return (
        <Routes>
            <Route element={<Layout />}>
                <Route index element={<PublicCalendar />} />
                <Route path="events/:id" element={<EventDetail />} />
                <Route path="events/:id/:day" element={<EventDetail />} />
                <Route path="events" element={<Navigate to="/" replace />} />
                <Route path="*" element={<NotFound />} />
            </Route>
        </Routes>
    );
}
