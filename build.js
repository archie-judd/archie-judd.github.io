#!/usr/bin/env node

import { promises } from "fs";
import hljs from "highlight.js";
import * as yaml from "js-yaml";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);

// Code syntax highlighting
const marked = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, lang, info) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return hljs.highlight(code, { language }).value;
    },
  }),
);

const markdown = "```python\nstart = dt.datetime(2024,10,2)\n```";

const html = marked.parse(markdown);
console.log(html);

const CONFIG = {
  EXCERPT_MAX_LENGTH: 300,
  HOME_POSTS_COUNT: 5,
  EXCERPT_SENTENCE_THRESHOLD: 0.6,
  OUTPUT_DIR: "docs",
  RSS_MAX_POSTS: 20,
};

async function loadTemplates() {
  const templateFiles = [
    "head.html",
    "header.html",
    "footer.html",
    "index.html",
    "post.html",
    "archive.html",
    "about.html",
  ];

  try {
    const templates = {};
    for (const file of templateFiles) {
      const templateName = file.replace(".html", "");
      templates[templateName] = await promises.readFile(
        `src/templates/${file}`,
        "utf8",
      );
      console.log(`Loaded ${file} template`);
    }
    return templates;
  } catch (error) {
    console.error("Error loading templates:", error);
    process.exit(1);
  }
}

async function loadBlogData() {
  try {
    const yamlContent = await promises.readFile("src/content.yml", "utf8");
    const yamlData = yaml.load(yamlContent);

    // Process posts
    const posts = yamlData.posts.map((post) => ({
      title: post.title,
      subtitle: post.subtitle || "",
      date: new Date(post.date),
      filepath: post.filepath,
      url: post.url,
    }));

    // Sort posts by date (newest first)
    posts.sort((a, b) => new Date(b.date) - new Date(a.date));

    const data = {
      title: yamlData.title,
      author: yamlData.author,
      description: `${yamlData.title} - ${yamlData.author}'s personal website`,
      url: yamlData.url,
      about: { filepath: yamlData.about.filepath },
      posts,
    };

    console.log(`Loaded ${posts.length} posts`);
    return data;
  } catch (error) {
    console.error("Error loading content.yml:", error);
    process.exit(1);
  }
}

async function loadContent(filepath) {
  try {
    return await promises.readFile(filepath, "utf8");
  } catch (error) {
    console.error(`Error loading ${filepath}:`, error);
    return null;
  }
}

function formatDate(dateString) {
  const options = { year: "numeric", month: "long", day: "numeric" };
  return new Date(dateString).toLocaleDateString("en-US", options);
}

function formatRSSDate(date) {
  return new Date(date).toUTCString();
}

function createExcerpt(content, maxLength = CONFIG.EXCERPT_MAX_LENGTH) {
  if (!content) return "No content available.";

  // Remove markdown formatting for excerpt
  let plainText = content
    .replace(/#{1,6}\s+/g, "") // Remove headers
    .replace(/\*\*(.*?)\*\*/g, "$1") // Remove bold
    .replace(/\*(.*?)\*/g, "$1") // Remove italic
    .replace(/\[(.*?)\]\(.*?\)/g, "$1") // Remove links, keep text
    .replace(/`(.*?)`/g, "$1") // Remove inline code
    .replace(/\n+/g, " ") // Replace newlines with spaces
    .trim();

  if (plainText.length <= maxLength) return plainText;

  // Find last complete sentence within limit
  const truncated = plainText.substring(0, maxLength);
  const lastSentence = truncated.lastIndexOf(".");

  if (lastSentence > maxLength * CONFIG.EXCERPT_SENTENCE_THRESHOLD) {
    return truncated.substring(0, lastSentence + 1);
  }

  // Fallback to word boundary
  const lastSpace = truncated.lastIndexOf(" ");
  return truncated.substring(0, lastSpace) + "...";
}

function groupPostsByYear(posts) {
  const postsByYear = {};
  posts.forEach((post) => {
    const year = post.date.getFullYear();
    const month = post.date.toLocaleDateString("en-US", { month: "long" });

    if (!postsByYear[year]) {
      postsByYear[year] = {};
    }
    if (!postsByYear[year][month]) {
      postsByYear[year][month] = [];
    }
    postsByYear[year][month].push(post);
  });
  return postsByYear;
}

function generateNavigation(activeNav = null) {
  const navItems = [
    { path: "/", label: "Home", key: "home" },
    { path: "/archive/", label: "Archive", key: "archive" },
    { path: "/about/", label: "About", key: "about" },
  ];

  return navItems
    .map((item) => {
      const isActive = item.key === activeNav;
      const style = isActive ? "color: #3d362e; font-weight: 600;" : "";
      return `<li><a href="${item.path}" style="${style}">${item.label}</a></li>`;
    })
    .join("");
}

function generateFeaturedPost(post, postContent, isFirst = false) {
  const postExcerpt = createExcerpt(postContent);
  const cssClass = isFirst ? "first-post" : "subsequent-post";

  return `
    <article class="featured-post ${cssClass}">
      <div class="post-date">${formatDate(post.date)}</div>
      <h2 class="post-title">${post.title}</h2>
      <p class="post-subtitle">${post.subtitle}</p>
      <div class="post-excerpt">
        <p>${postExcerpt}</p>
      </div>
      <a href="/${post.url}/" class="read-more">Continue reading</a>
    </article>
  `;
}

function generatePostNavigation(post, posts) {
  const currentIndex = posts.findIndex((p) => p.url === post.url);
  let navHTML = '<div class="post-nav-container">';

  if (currentIndex > 0) {
    const prevPost = posts[currentIndex - 1];
    navHTML += `
      <div class="post-nav-left">
        <a href="/${prevPost.url}/" class="nav-button">Previous</a>
      </div>
    `;
  }

  if (currentIndex < posts.length - 1) {
    const nextPost = posts[currentIndex + 1];
    navHTML += `
      <div class="post-nav-right">
        <a href="/${nextPost.url}/" class="nav-button">Next</a>
      </div>
    `;
  }

  navHTML += "</div>";
  return navHTML;
}

function generateArchivePage(postsByYear) {
  let archiveHTML = "";
  const sortedYears = Object.keys(postsByYear).sort((a, b) => b - a);

  sortedYears.forEach((year) => {
    archiveHTML += `<div class="archive-year"><h2>${year}</h2>`;

    const months = Object.keys(postsByYear[year]);
    months.sort((a, b) => {
      const dateA = new Date(`${a} 1, ${year}`);
      const dateB = new Date(`${b} 1, ${year}`);
      return dateB - dateA;
    });

    months.forEach((month) => {
      const monthPosts = postsByYear[year][month];
      archiveHTML += `<div class="archive-month">`;

      monthPosts.forEach((post, index) => {
        const date = new Date(post.date);
        const day = date.getDate().toString().padStart(2, "0");
        const isFirstInMonth = index === 0;

        archiveHTML += `<div class="archive-entry">`;

        if (isFirstInMonth) {
          archiveHTML += `
            <h3 class="archive-month-header">${month}</h3>
            <div>
              <span class="archive-date">${day}</span> &nbsp;&nbsp;-&nbsp;&nbsp;
              <a href="/${post.url}/" class="archive-link">${post.title}</a>
            </div>
          `;
        } else {
          archiveHTML += `
            <div class="archive-month-spacer"></div>
            <span class="archive-date">${day}</span> &nbsp;&nbsp;-&nbsp;&nbsp;
            <a href="/${post.url}/" class="archive-link">${post.title}</a>
          `;
        }

        archiveHTML += "</div>";
      });

      archiveHTML += "</div>";
    });

    archiveHTML += "</div>";
  });

  return archiveHTML;
}

async function generateRSSFeed(data) {
  console.log("Generating RSS feed...");

  const postsForRSS = data.posts.slice(0, CONFIG.RSS_MAX_POSTS);
  let rssItems = "";

  for (const post of postsForRSS) {
    const content = await loadContent(post.filepath);
    const description = content ? createExcerpt(content, 500) : post.subtitle;
    const postUrl = `${data.url}/${post.url}/`;

    rssItems += `
    <item>
      <title><![CDATA[${post.title}]]></title>
      <description><![CDATA[${description}]]></description>
      <link>${postUrl}</link>
      <guid>${postUrl}</guid>
      <pubDate>${formatRSSDate(post.date)}</pubDate>
    </item>`;
  }

  const lastBuildDate = formatRSSDate(new Date());
  const mostRecentPostDate =
    data.posts.length > 0 ? formatRSSDate(data.posts[0].date) : lastBuildDate;
  const email = `noreply@${data.url.replace(/https?:\/\//, "").replace(/\/$/, "")}`;

  const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title><![CDATA[${data.title}]]></title>
    <description><![CDATA[${data.description}]]></description>
    <link>${data.url}</link>
    <atom:link href="${data.url}/feed.xml" rel="self" type="application/rss+xml"/>
    <language>en-us</language>
    <managingEditor>${email} (${data.author})</managingEditor>
    <webMaster>${email} (${data.author})</webMaster>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <pubDate>${mostRecentPostDate}</pubDate>
    <ttl>60</ttl>${rssItems}
  </channel>
</rss>`;

  return rssXml;
}

async function ensureDir(dirPath) {
  try {
    await promises.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }
}

function generateHead(template, data, asset_dir) {
  console.log("Generating head...");
  return template
    .replace(/\{\{TITLE\}\}/g, data.title)
    .replace(/\{\{SITE_TITLE\}\}/g, data.title)
    .replace(/\{\{ASSETS_DIR\}\}/g, asset_dir)
    .replace(/\{\{RSS_URL\}\}/g, "/feed.xml");
}

function generateHeader(template, data, activeNav = null) {
  console.log("Generating header...");

  const navHTML = generateNavigation(activeNav);
  const html = template
    .replace(/\{\{SITE_TITLE\}\}/g, data.title)
    .replace(/\{\{NAVIGATION\}\}/g, navHTML);

  return html;
}

function generateFooter(template, data) {
  console.log("Generating footer...");

  const html = template
    .replace(/\{\{CURRENT_YEAR\}\}/g, new Date().getFullYear())
    .replace(/\{\{AUTHOR\}\}/g, data.author)
    .replace(/\{\{RSS_URL\}\}/g, "/feed.xml");

  return html;
}

async function buildHomePage(templates, data) {
  console.log("Building home page...");

  const postsToShow = data.posts.slice(0, CONFIG.HOME_POSTS_COUNT);
  let contentHTML = "";

  for (let i = 0; i < postsToShow.length; i++) {
    const post = postsToShow[i];
    const postContent = await loadContent(post.filepath);

    if (postContent) {
      contentHTML += generateFeaturedPost(post, postContent, i === 0);

      if (i < postsToShow.length - 1) {
        contentHTML += '<hr class="post-separator">';
      }
    }
  }
  const headHTML = generateHead(templates.head, data, "../assets");
  const headerHTML = generateHeader(templates.header, data, "home");
  const footerHTML = generateFooter(templates.footer, data);

  const html = templates.index
    .replace(/\{\{HEAD\}\}/g, headHTML)
    .replace(/\{\{HEADER\}\}/g, headerHTML)
    .replace(/\{\{CONTENT\}\}/g, contentHTML)
    .replace(/\{\{FOOTER\}\}/g, footerHTML);

  await ensureDir(CONFIG.OUTPUT_DIR);
  await promises.writeFile(`${CONFIG.OUTPUT_DIR}/index.html`, html);
  console.log("Built index.html");
}

async function buildPostPages(templates, data) {
  console.log("Building post pages...");

  const headHTML = generateHead(templates.head, data, "../../assets");
  const headerHTML = generateHeader(templates.header, data, null);
  const footerHTML = generateFooter(templates.footer, data);

  for (const post of data.posts) {
    const content = await loadContent(post.filepath);

    if (!content) {
      console.warn(`Could not load content for ${post.url}`);
      continue;
    }
    const postContentHTML = marked.parse(content);
    const postNavigationHTML = generatePostNavigation(post, data.posts);
    const postDate = formatDate(post.date);

    const html = templates.post
      .replace(/\{\{HEAD\}\}/g, headHTML)
      .replace(/\{\{HEADER\}\}/g, headerHTML)
      .replace(/\{\{POST_DATE\}\}/g, postDate)
      .replace(/\{\{POST_TITLE\}\}/g, post.title)
      .replace(/\{\{POST_SUBTITLE\}\}/g, post.subtitle)
      .replace(/\{\{POST_CONTENT\}\}/g, postContentHTML)
      .replace(/\{\{POST_NAVIGATION\}\}/g, postNavigationHTML)
      .replace(/\{\{FOOTER\}\}/g, footerHTML);

    await ensureDir(`${CONFIG.OUTPUT_DIR}/${post.url}`);
    await promises.writeFile(
      `${CONFIG.OUTPUT_DIR}/${post.url}/index.html`,
      html,
    );
    console.log(`Built ${post.url}/index.html`);
  }
}

async function buildAboutPage(templates, data) {
  console.log("Building about page...");

  const content = await loadContent(data.about.filepath);
  const aboutContent = content
    ? marked.parse(content)
    : "<p>About content could not be loaded.</p>";
  const headHTML = generateHead(templates.head, data, "../assets");
  const headerHTML = generateHeader(templates.header, data, "about");
  const footerHTML = generateFooter(templates.footer, data);

  const html = templates.about
    .replace(/\{\{HEAD\}\}/g, headHTML)
    .replace(/\{\{HEADER\}\}/g, headerHTML)
    .replace(/\{\{CONTENT\}\}/g, aboutContent)
    .replace(/\{\{FOOTER\}\}/g, footerHTML);

  await ensureDir(`${CONFIG.OUTPUT_DIR}/about`);
  await promises.writeFile(`${CONFIG.OUTPUT_DIR}/about/index.html`, html);
  console.log("Built about/index.html");
}

async function buildArchivePage(templates, data) {
  console.log("Building archive page...");

  const postsByYear = groupPostsByYear(data.posts);
  const archiveHTML = generateArchivePage(postsByYear);
  const headHTML = generateHead(templates.head, data, "../assets");
  const headerHTML = generateHeader(templates.header, data, "archive");
  const footerHTML = generateFooter(templates.footer, data);

  const html = templates.archive
    .replace(/\{\{HEAD\}\}/g, headHTML)
    .replace(/\{\{HEADER\}\}/g, headerHTML)
    .replace(/\{\{CONTENT\}\}/g, archiveHTML)
    .replace(/\{\{FOOTER\}\}/g, footerHTML);

  await ensureDir(`${CONFIG.OUTPUT_DIR}/archive`);
  await promises.writeFile(`${CONFIG.OUTPUT_DIR}/archive/index.html`, html);
  console.log("Built archive/index.html");
}

async function buildRSSFeed(data) {
  console.log("Building RSS feed...");

  const rssXml = await generateRSSFeed(data);
  await promises.writeFile(`${CONFIG.OUTPUT_DIR}/feed.xml`, rssXml);
  console.log("Built feed.xml");
}

async function copyDirectory(src, dest) {
  await promises.access(src);
  await ensureDir(dest);
  const entries = await promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await promises.copyFile(srcPath, destPath);
    }
  }
}

async function build() {
  console.log("Starting blog build...\n");

  try {
    await promises.rm(CONFIG.OUTPUT_DIR, { recursive: true, force: true });
    console.log(`Cleaned ${CONFIG.OUTPUT_DIR} directory`);
  } catch (error) {}

  // Load templates first
  const templates = await loadTemplates();
  const data = await loadBlogData();

  // Build all pages
  await buildHomePage(templates, data);
  await buildPostPages(templates, data);
  await buildAboutPage(templates, data);
  await buildArchivePage(templates, data);
  await buildRSSFeed(data);
  await copyDirectory("src/assets", `${CONFIG.OUTPUT_DIR}/assets`);
  await promises.copyFile("src/CNAME", `${CONFIG.OUTPUT_DIR}/CNAME`);

  console.log("Blog build completed successfully!");
  console.log(
    `Generated ${data.posts.length + 5} pages in ${CONFIG.OUTPUT_DIR}/`,
  );
}

if (process.argv[1] === __filename) {
  build().catch((error) => {
    console.error("Build failed:", error);
    process.exit(1);
  });
}
