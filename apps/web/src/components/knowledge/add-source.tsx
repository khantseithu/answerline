"use client";

import {
  FileTextIcon,
  GlobeIcon,
  MessagesSquareIcon,
  PlusIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";
import { type FormEvent, useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { addKnowledgeSource, uploadKnowledgeFile } from "@/lib/knowledge/client";
import {
  KNOWLEDGE_FILE_EXTENSIONS,
  knowledgeFileExtension,
  MAX_KNOWLEDGE_FILE_BYTES,
} from "@/lib/knowledge/file-rules";

type OnChange = () => Promise<void>;

const FILE_ACCEPT = KNOWLEDGE_FILE_EXTENSIONS.join(",");

function useSubmit(onChange: OnChange) {
  const [pending, setPending] = useState(false);

  const submit = useCallback(
    async (form: HTMLFormElement, action: () => Promise<void>, success: string) => {
      setPending(true);
      try {
        await action();
        form.reset();
        toast.success(success);
        await onChange();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Something went wrong");
      } finally {
        setPending(false);
      }
    },
    [onChange]
  );

  return { pending, submit };
}

function SubmitButton({ children, pending }: { children: string; pending: boolean }) {
  return (
    <Button className="self-start" disabled={pending} type="submit">
      {pending ? <Spinner data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
      {children}
    </Button>
  );
}

function UrlForm({ onChange }: { onChange: OnChange }) {
  const { pending, submit } = useSubmit(onChange);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      submit(
        form,
        () =>
          addKnowledgeSource({
            title: String(data.get("title") ?? ""),
            type: "url",
            url: String(data.get("url") ?? ""),
          }),
        "Web page added"
      );
    },
    [submit]
  );

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="url-source-url">Page address</FieldLabel>
          <Input
            id="url-source-url"
            name="url"
            placeholder="https://example.com/pricing"
            required
            type="url"
          />
          <FieldDescription>
            The page is fetched and its main text is indexed. Only public pages work.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="url-source-title">Title (optional)</FieldLabel>
          <Input id="url-source-title" maxLength={200} name="title" placeholder="Pricing" />
        </Field>
        <SubmitButton pending={pending}>Add web page</SubmitButton>
      </FieldGroup>
    </form>
  );
}

function FileForm({ onChange }: { onChange: OnChange }) {
  const { pending, submit } = useSubmit(onChange);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const file = new FormData(form).get("file");
      if (!(file instanceof File) || file.size === 0) {
        toast.error("Choose a file to upload");
        return;
      }
      if (!knowledgeFileExtension(file.name)) {
        toast.error("Files must be PDF, plain text or Markdown");
        return;
      }
      if (file.size > MAX_KNOWLEDGE_FILE_BYTES) {
        toast.error("File exceeds 20 MiB");
        return;
      }
      submit(form, () => uploadKnowledgeFile(file), "File uploaded");
    },
    [submit]
  );

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="file-source-file">File</FieldLabel>
          <Input accept={FILE_ACCEPT} id="file-source-file" name="file" required type="file" />
          <FieldDescription>
            PDF, plain text or Markdown, up to 20 MiB. Scanned PDFs without text are not supported.
          </FieldDescription>
        </Field>
        <SubmitButton pending={pending}>Upload file</SubmitButton>
      </FieldGroup>
    </form>
  );
}

function TextForm({ onChange }: { onChange: OnChange }) {
  const { pending, submit } = useSubmit(onChange);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      submit(
        form,
        () =>
          addKnowledgeSource({
            content: String(data.get("content") ?? ""),
            title: String(data.get("title") ?? ""),
            type: "text",
          }),
        "Text added"
      );
    },
    [submit]
  );

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="text-source-title">Title</FieldLabel>
          <Input
            id="text-source-title"
            maxLength={200}
            name="title"
            placeholder="Opening hours"
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="text-source-content">Text</FieldLabel>
          <Textarea
            className="min-h-32"
            id="text-source-content"
            name="content"
            placeholder="We are open Monday to Friday, 8am to 5pm."
            required
          />
        </Field>
        <SubmitButton pending={pending}>Add text</SubmitButton>
      </FieldGroup>
    </form>
  );
}

function QaForm({ onChange }: { onChange: OnChange }) {
  const { pending, submit } = useSubmit(onChange);
  const [rows, setRows] = useState([0]);
  const [nextRow, setNextRow] = useState(1);

  const addRow = useCallback(() => {
    setRows((current) => [...current, nextRow]);
    setNextRow((current) => current + 1);
  }, [nextRow]);

  const removeRow = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const row = Number(event.currentTarget.dataset.row);
    setRows((current) => current.filter((value) => value !== row));
  }, []);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const questions = data.getAll("question").map(String);
      const answers = data.getAll("answer").map(String);
      submit(
        form,
        async () => {
          await addKnowledgeSource({
            pairs: questions.map((question, index) => ({
              answer: answers[index] ?? "",
              question,
            })),
            title: String(data.get("title") ?? ""),
            type: "qa",
          });
          setRows([nextRow]);
          setNextRow((current) => current + 1);
        },
        "Q&A added"
      );
    },
    [nextRow, submit]
  );

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="qa-source-title">Title</FieldLabel>
          <Input
            id="qa-source-title"
            maxLength={200}
            name="title"
            placeholder="Common questions"
            required
          />
        </Field>
        {rows.map((row, index) => (
          <FieldSet className="gap-3 rounded-lg border bg-muted/30 p-3" key={row}>
            <FieldLegend className="sr-only">Pair {index + 1}</FieldLegend>
            <Field>
              <FieldLabel htmlFor={`qa-question-${row}`}>Question {index + 1}</FieldLabel>
              <Input
                id={`qa-question-${row}`}
                name="question"
                placeholder="Do you accept walk-ins?"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`qa-answer-${row}`}>Answer</FieldLabel>
              <Textarea
                id={`qa-answer-${row}`}
                name="answer"
                placeholder="Yes, but appointments are seen first."
                required
              />
            </Field>
            {rows.length > 1 ? (
              <Button
                className="self-start"
                data-row={row}
                onClick={removeRow}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Trash2Icon data-icon="inline-start" />
                Remove pair
              </Button>
            ) : null}
          </FieldSet>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button onClick={addRow} type="button" variant="outline">
            <PlusIcon data-icon="inline-start" />
            Add another pair
          </Button>
          <SubmitButton pending={pending}>Save Q&A</SubmitButton>
        </div>
      </FieldGroup>
    </form>
  );
}

export function AddSource({ onChange }: { onChange: OnChange }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a source</CardTitle>
        <CardDescription>
          Sources are indexed in the background. Changes show up in the list below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="url">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="url">
              <GlobeIcon />
              Web page
            </TabsTrigger>
            <TabsTrigger value="file">
              <FileTextIcon />
              File
            </TabsTrigger>
            <TabsTrigger value="text">
              <TypeIcon />
              Text
            </TabsTrigger>
            <TabsTrigger value="qa">
              <MessagesSquareIcon />
              Q&A
            </TabsTrigger>
          </TabsList>
          <TabsContent className="max-w-xl pt-4" value="url">
            <UrlForm onChange={onChange} />
          </TabsContent>
          <TabsContent className="max-w-xl pt-4" value="file">
            <FileForm onChange={onChange} />
          </TabsContent>
          <TabsContent className="max-w-xl pt-4" value="text">
            <TextForm onChange={onChange} />
          </TabsContent>
          <TabsContent className="max-w-xl pt-4" value="qa">
            <QaForm onChange={onChange} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
