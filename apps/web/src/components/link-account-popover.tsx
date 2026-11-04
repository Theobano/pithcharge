"use client";

import { useState } from "react";
import { SparkleIcon } from "@phosphor-icons/react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { LoginForm } from "./login-form";
import { RegisterForm } from "./register-form";

export function LinkAccountPopover() {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-none px-2 py-2 text-left text-xs outline-hidden select-none focus:bg-accent focus:text-accent-foreground"
          >
            <SparkleIcon className="size-4" />
            Link Account
          </button>
        }
      />

      <PopoverContent
        className="w-[min(92vw,360px)] max-h-[85vh] overflow-hidden p-0"
        onKeyDownCapture={(event) => event.stopPropagation()}
        onPointerDownCapture={(event) => event.stopPropagation()}
      >
        <Card className="border-0 shadow-none">
          <CardContent className="max-h-[75vh] overflow-y-auto p-3">
            <Tabs defaultValue="login" className="gap-3">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Log in</TabsTrigger>
                <TabsTrigger value="signup">Sign up</TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="p-0">
                <LoginForm fullForm={false} className="gap-4" />
              </TabsContent>
              <TabsContent value="signup" className="p-0">
                <RegisterForm fullForm={false} className="gap-4" />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </PopoverContent>
    </Popover>
  );
}
