import { useState, useEffect, useMemo, useRef } from "react";
import {
  format,
  isSameDay,
  add,
  differenceInMinutes,
  areIntervalsOverlapping,
  startOfDay,
  sub,
  set,
  getDate,
} from "date-fns";
import ical from "ical";
import { rrulestr } from "rrule";
import Redirect from "./components/Redirect";
import FilterSection, { DayFilter, TopicsFilter } from "./components/filters";
import BlockSection from "./components/block";
import ConfirmDialog from "./components/ConfirmDialog";
import config from "./config";

const weeks = 3;

const rules = {
  lunch: (b) => b.summary?.includes("Lunch"),
  dinner: (b) => b.summary?.includes("Dinner"),
  work: (b) => b.summary?.includes("Work") && b.date.getHours() < 17,
  afternoon: (b) => b.date.getHours() >= 12 && b.date.getHours() < 18,
  evening: (b) => b.date.getHours() >= 18,
};

const App = () => {
  const cal = useCalendar(config.cal);
  const plans = config.plans.map((plan) => useCalendar(plan));

  const [day, setDay] = useState("");
  const [block, setBlock] = useState("");
  const [topics, setTopics] = useState([]);

  const scrolls = useRef(new Map());

  const blocks = useBlocks(
    cal?.data,
    plans?.map((p) => p?.data),
    topics
  );
  const [dates, enabledDates] = useDates(blocks);

  useEffect(() => {
    if (
      enabledDates.length > 0 &&
      (day === "" || !enabledDates.find((d) => isSameDay(d.date, day)))
    ) {
      setDay(enabledDates[0].date);
    }
  }, [enabledDates, day]);

  return (
    <Redirect error={cal?.error}>
      <div className="fixed top-0 right-0 left-0 bottom-0 flex flex-col sm:gap-4 overflow-hidden">
        <div className="bg-slate-700 w-full py-3">
          <h1 className="font-semibold text-xl sm:text-2xl text-center">
            Schedule with {config.name}
          </h1>
        </div>
        <div className="max-w-xl mx-auto w-full min-h-0 flex flex-col sm:gap-4">
          <div className="bg-slate-800 items-center justify-between px-4 pt-4">
            <FilterSection>
              <TopicsFilter topics={topics} setTopics={setTopics} />
              <DayFilter
                value={day}
                onChange={(e) => {
                  setDay(e);
                  scrolls.current.get(format(e, "L-d")).scrollIntoView({
                    behavior: "smooth",
                  });
                }}
                dates={dates}
                disabled={(d) => !enabledDates.includes(d)}
              />
            </FilterSection>
          </div>
          <div className="sm:mx-4 border-t-4 border-slate-700" />
          <BlockSection
            day={day}
            value={block}
            onChange={setBlock}
            blocks={blocks}
            scrolls={scrolls}
          />
        </div>
      </div>
      <ConfirmDialog block={block} setBlock={setBlock} />
    </Redirect>
  );
};

const useBlocks = (data, plansData, topics) => {
  const blocks = useMemo(() => {
    if (!data || plansData.includes(undefined)) return [];

    const now = new Date();
    const then = add(now, { weeks });
    const blocks = [];
    Object.values(data)
      .filter((event) => event.type === "VEVENT")
      .forEach((event) => {
        if (event.rrule) {
          rrulestr(event.rrule.toString())
            .between(adjustDate(now, add), adjustDate(then, add))
            .forEach((occurrence) => {
              const adjustedDate = adjustDate(occurrence, sub);
              if (adjustedDate > now)
                blocks.push({
                  ...event,
                  date: adjustedDate,
                  endDate: add(adjustedDate, {
                    minutes: differenceInMinutes(event.end, event.start),
                  }),
                  id: event.uid + adjustedDate.toString(),
                });
            });
        } else if (then > event.start && event.start > now) {
          blocks.push({
            ...event,
            date: event.start,
            endDate: event.end,
            id: event.uid,
          });
        }
      });

    const planBlocks = [];
    plansData
      .flatMap((p) => Object.values(p))
      .filter((event) => (event.type = "VEVENT"))
      .forEach((event) => {
        if (event.recurrences) {
          Object.entries(event.recurrences).forEach((val) => {
            const occurrence = val[1].start;
            if (then > occurrence && occurrence > now) {
              planBlocks.push({
                ...event,
                date: occurrence,
                endDate: add(occurrence, {
                  minutes: differenceInMinutes(event.end, event.start),
                }),
                id: event.uid + occurrence.toString(),
              });
            }
          });
        }
        if (then > event.start && event.start > now) {
          planBlocks.push({
            ...event,
            date: event.start,
            endDate: event.end,
            id: event.uid,
          });
        }
      });
    return blocks.filter(
      (b) =>
        planBlocks.filter((p) =>
          areIntervalsOverlapping(
            { start: b.date, end: b.endDate },
            { start: p.date, end: p.endDate }
          )
        ).length === 0
    );
  }, [data, plansData]);

  const filteredBlocks = useMemo(() => {
    if (!blocks.length) return [];

    return blocks.filter((b) => {
      return topics.length === 0
        ? true
        : topics.reduce((p, t) => (p ? p : rules[t](b)), false);
    });
  }, [blocks, topics]);

  return filteredBlocks;
};

const useDates = (blocks) => {
  const [dates, enabledDates] = useMemo(() => {
    const today = startOfDay(new Date());
    const dates = Array.from({ length: weeks * 7 }, (_, i) => {
      const nextDate = add(today, { days: i });
      return {
        date: nextDate,
        label:
          nextDate.getTime() === today.getTime()
            ? "Today"
            : nextDate.getTime() === today.getTime() + 60 * 60 * 24000
            ? "Tmrw"
            : format(nextDate, "EEE"),
      };
    });
    const enabledDates = dates.filter(
      (d) => blocks.filter((b) => isSameDay(b.date, d.date)).length !== 0
    );
    return [dates, enabledDates];
  }, [blocks]);

  return [dates, enabledDates];
};

const useCalendar = (url) => {
  const [cal, setCal] = useState();

  useEffect(() => {
    fetch("https://corsproxy.io/?" + url)
      .then((resp) => {
        if (resp.ok) {
          resp.text().then((text) => setCal({ data: ical.parseICS(text) }));
        } else {
          resp.text().then((text) => setCal({ error: text }));
        }
      })
      .catch((error) => {
        setCal({ error: error.message });
      });
  }, [url]);

  return cal;
};

// rrule has a bug with timezones where the "day" specifically is not accounted for in the timezone.
const adjustDate = (date, method) => {
  const artificialOffset = method(date, {
    minutes: date.getTimezoneOffset(),
  });
  return set(date, {
    date: getDate(artificialOffset),
  });
};

export default App;
