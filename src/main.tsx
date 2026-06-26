import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { TooltipProvider } from "./components/ui/Tooltip.tsx";
import { Layout } from "./components/Layout.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { CategoryPage } from "./pages/CategoryPage.tsx";
import { NotePage } from "./pages/NotePage.tsx";
import { LabelPage } from "./pages/LabelPage.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={350} skipDelayDuration={200}>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/label/:label" element={<LabelPage />} />
              <Route path="/:category" element={<CategoryPage />} />
              <Route path="/:category/:id" element={<NotePage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </MotionConfig>
  </StrictMode>,
);
