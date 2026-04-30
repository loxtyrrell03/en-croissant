import { RichTextEditor } from "@mantine/tiptap";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useAtomValue } from "jotai";
import { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { spellCheckAtom } from "@/state/atoms";
import { getNodeAtPath } from "@/utils/treeReducer";

const COMMENT_SAVE_DELAY_MS = 350;

function AnnotationEditor() {
  const { t } = useTranslation();

  const store = useContext(TreeStateContext)!;
  const position = useStore(store, (s) => s.position);
  const positionKey = useMemo(() => position.join(","), [position]);
  const currentComment = useStore(store, (s) => getNodeAtPath(s.root, s.position).comment);
  const setCommentAtPath = useStore(store, (s) => s.setCommentAtPath);
  const pendingSaveRef = useRef<{ path: number[]; comment: string } | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);

  const clearSaveTimeout = useCallback(() => {
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
  }, []);

  const flushPendingComment = useCallback(() => {
    clearSaveTimeout();
    const pending = pendingSaveRef.current;
    if (!pending) return;

    pendingSaveRef.current = null;
    setCommentAtPath(pending.path, pending.comment);
  }, [clearSaveTimeout, setCommentAtPath]);

  const scheduleCommentSave = useCallback(
    (path: number[], comment: string) => {
      pendingSaveRef.current = {
        path: [...path],
        comment,
      };
      clearSaveTimeout();
      saveTimeoutRef.current = window.setTimeout(flushPendingComment, COMMENT_SAVE_DELAY_MS);
    },
    [clearSaveTimeout, flushPendingComment],
  );

  useEffect(() => {
    return () => flushPendingComment();
  }, [flushPendingComment, positionKey]);

  const spellCheck = useAtomValue(spellCheckAtom);
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          link: {
            autolink: true,
            openOnClick: false,
          },
        }),
        Markdown,
        Placeholder.configure({ placeholder: t("Board.Annotate.WriteHere") }),
      ],
      content: currentComment || null,
      contentType: "markdown",
      onUpdate: ({ editor }) => {
        scheduleCommentSave(position, editor.getMarkdown());
      },
      onBlur: flushPendingComment,
    },
    [positionKey],
  );

  return (
    <RichTextEditor
      editor={editor}
      spellCheck={spellCheck}
      labels={{
        boldControlLabel: t("RichText.Bold"),
        italicControlLabel: t("RichText.Italic"),
        underlineControlLabel: t("RichText.Underline"),
        strikeControlLabel: t("RichText.Strike"),
        clearFormattingControlLabel: t("RichText.ClearFormatting"),
        h1ControlLabel: t("RichText.H1"),
        h2ControlLabel: t("RichText.H2"),
        h3ControlLabel: t("RichText.H3"),
        h4ControlLabel: t("RichText.H4"),
        blockquoteControlLabel: t("RichText.Quote"),
        hrControlLabel: t("RichText.HLine"),
        bulletListControlLabel: t("RichText.BulletList"),
        orderedListControlLabel: t("RichText.NumberedList"),
        linkControlLabel: t("RichText.Link"),
        unlinkControlLabel: t("RichText.RemoveLink"),
      }}
    >
      <RichTextEditor.Toolbar>
        <RichTextEditor.ControlsGroup>
          <RichTextEditor.Bold />
          <RichTextEditor.Italic />
          <RichTextEditor.Underline />
          <RichTextEditor.Strikethrough />
          <RichTextEditor.ClearFormatting />
        </RichTextEditor.ControlsGroup>

        <RichTextEditor.ControlsGroup>
          <RichTextEditor.H1 />
          <RichTextEditor.H2 />
          <RichTextEditor.H3 />
          <RichTextEditor.H4 />
        </RichTextEditor.ControlsGroup>

        <RichTextEditor.ControlsGroup>
          <RichTextEditor.Blockquote />
          <RichTextEditor.Hr />
          <RichTextEditor.BulletList />
          <RichTextEditor.OrderedList />
        </RichTextEditor.ControlsGroup>
        <RichTextEditor.ControlsGroup>
          <RichTextEditor.Link />
          <RichTextEditor.Unlink />
        </RichTextEditor.ControlsGroup>
      </RichTextEditor.Toolbar>

      <RichTextEditor.Content />
    </RichTextEditor>
  );
}

export default AnnotationEditor;
