import { Navigate, Route, Routes } from "react-router-dom";

import Layout from "./components/Layout";
import RequireBeirat from "./components/RequireBeirat";
import RequireBoardAccess from "./components/RequireBoardAccess";
import NotFound from "./pages/NotFound";
import PublicCalendar from "./pages/PublicCalendar";
import Home from "./pages/Home";
import Announcements from "./pages/Announcements";
import Contacts from "./pages/Contacts";
import Documents from "./pages/Documents";
import Participate from "./pages/Participate";
import MySubmissions from "./pages/MySubmissions";
import RequireLogin from "./components/RequireLogin";
import EventDetail from "./pages/EventDetail";
import EventEditor from "./pages/EventEditor";
import NewSuggestion from "./pages/NewSuggestion";
import NewIssue from "./pages/NewIssue";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ProfileSettings from "./pages/ProfileSettings";
import IssueBoard from "./pages/IssueBoard";
import IssueDetail from "./pages/IssueDetail";
import ModerationQueue from "./pages/ModerationQueue";
import UserApproval from "./pages/UserApproval";
import Notes from "./pages/Notes";
import Impressum from "./pages/Impressum";
import Datenschutz from "./pages/Datenschutz";

export default function App() {
    return (
        <Routes>
            <Route element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="kalender" element={<PublicCalendar />} />
                <Route path="aktuelles" element={<Announcements />} />
                <Route path="kontakte" element={<Contacts />} />
                <Route path="dokumente" element={<Documents />} />
                <Route
                    path="mitreden"
                    element={
                        <RequireBoardAccess>
                            <Participate />
                        </RequireBoardAccess>
                    }
                />
                <Route
                    path="meine-einreichungen"
                    element={
                        <RequireLogin>
                            <MySubmissions />
                        </RequireLogin>
                    }
                />
                <Route
                    path="events/new"
                    element={
                        <RequireBeirat>
                            <EventEditor />
                        </RequireBeirat>
                    }
                />
                <Route
                    path="events/:id/edit"
                    element={
                        <RequireBeirat>
                            <EventEditor />
                        </RequireBeirat>
                    }
                />
                <Route path="events/:id" element={<EventDetail />} />
                <Route path="events/:id/:day" element={<EventDetail />} />
                <Route path="events" element={<Navigate to="/kalender" replace />} />
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
                <Route
                    path="profile"
                    element={
                        <RequireLogin>
                            <ProfileSettings />
                        </RequireLogin>
                    }
                />
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
                <Route
                    path="notes"
                    element={
                        <RequireBeirat>
                            <Notes />
                        </RequireBeirat>
                    }
                />
                <Route path="impressum" element={<Impressum />} />
                <Route path="datenschutz" element={<Datenschutz />} />
                <Route path="*" element={<NotFound />} />
            </Route>
        </Routes>
    );
}
