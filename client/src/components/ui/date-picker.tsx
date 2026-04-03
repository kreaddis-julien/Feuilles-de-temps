import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { format, parse } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  align?: 'start' | 'center' | 'end';
}

function toDate(dateStr: string): Date | undefined {
  if (!dateStr) return undefined;
  return parse(dateStr, 'yyyy-MM-dd', new Date());
}

function fromDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function DatePicker({ value, onChange, placeholder = 'Choisir une date', className, align = 'start' }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = toDate(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'w-full justify-start text-left font-normal h-9',
            !value && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarDays className="h-4 w-4 mr-2 shrink-0" />
          {selected ? format(selected, 'dd MMM yyyy', { locale: fr }) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (date) {
              onChange(fromDate(date));
              setOpen(false);
            }
          }}
          defaultMonth={selected}
          locale={fr}
        />
      </PopoverContent>
    </Popover>
  );
}
