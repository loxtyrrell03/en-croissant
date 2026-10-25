import { useEffect, useState } from "react";
import { calendarDate } from "@/utils/gameDateRange";

/** Local midnight is not always 24 hours away. Recheck after sleep/tab hiding. */
export function useCalendarDay() {
    const [day, setDay] = useState(() => calendarDate(new Date()));
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        const refresh = () => {
            clearTimeout(timer);
            const now = new Date();
            setDay(calendarDate(now));
            const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            timer = setTimeout(refresh, Math.max(1, midnight.getTime() - now.getTime()));
        };
        refresh();
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", refresh);
        return () => {
            clearTimeout(timer);
            window.removeEventListener("focus", refresh);
            document.removeEventListener("visibilitychange", refresh);
        };
    }, []);
    return day;
}
