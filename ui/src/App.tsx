import { Navigate, Route, Routes } from "react-router-dom";

import Layout from "./components/Layout";
import RequireBeirat from "./components/RequireBeirat";
import RequireBoardAccess from "./components/RequireBoardAccess";
import NotFound from "./pages/NotFound";
import PublicCalendar from "./pages/PublicCalendar";
import EventDetail from "./pages/EventDetail";
import NewSuggestion from "./pages/NewSuggestion";
import NewIssue from "./pages/NewIssue";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ProfileSettings from "./pages/ProfileSettings";
import IssueBoard from "./pages/IssueBoard";
import IssueDetail from "./pages/IssueDetail";
import ModerationQueue from "./pages/ModerationQueue";
import UserApproval from "./pages/UserApproval";

export default function App() {
    return (
        <Routes>
            <Route element={<Layout />}>
                <Route index element={<PublicCalendar />} />
                <Route path="events/:id" element={<EventDetail />} />
                <Route path="events/:id/:day" element={<EventDetail />} />
                <Route path="events" element={<Navigate to="/" replace />} />
                <Route path="suggestions/new" element={<NewSuggestion />} />
                <Route path="issues/new" element={<NewIssue />} />
                <Route path="issues" element={<RequireBoardAccess><IssueBoard /></RequireBoardAccess>} />
                <Route
                    path="issues/:id"
                    element={
                        <RequireBoardAccess>
                            <IssueDetail />
                        </RequireBoardAccess>
                    }
                />
                <Route path="login" element={<Login />} />
                <Route path="signup" element={<Signup />} />
                <Route path="profile" element={<ProfileSettings />} />
                <Route
                    path="moderation"
                    element={
                        <RequireBeirat>
                            <ModerationQueue />
                        </RequireBeirat>
                    }
                />
                <Route
                    path="users"
                    element={
                        <RequireBeirat>
                            <UserApproval />
                        </RequireBeirat>
                    }
                />
                <Route path="*" element={<NotFound />} />
            </Route>
        </Routes>
    );
}
