#!/usr/bin/env node

import { promises } from "fs";
import * as yaml from "js-yaml";
import { marked } from "marked";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);

const CONFIG = {
  EXCERPT_MAX_LENGTH: 300,
  HOME_POSTS_COUNT: 5,
  EXCERPT_SENTENCE_THRESHOLD: 0.6,
  OUTPUT_DIR: "docs",
};

async function loadTemplates() {
  const templateFiles = [
    "head.html",
    "header.html",
    "footer.html",
    "index.html",
    "post.html",
    "archive.html",
    "categories.html",
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
      category: post.category,
      filepath: post.filepath,
      url: post.url,
    }));

    // Sort posts by date (newest first)
    posts.sort((a, b) => new Date(b.date) - new Date(a.date));

    const data = {
      title: yamlData.title,
      author: yamlData.author,
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

function groupPostsByCategory(posts) {
  const categorizedPosts = {};
  posts.forEach((post) => {
    if (!categorizedPosts[post.category]) {
      categorizedPosts[post.category] = [];
    }
    categorizedPosts[post.category].push(post);
  });
  return categorizedPosts;
}

function generateNavigation(activeNav = null) {
  const navItems = [
    { path: "/", label: "Home", key: "home" },
    { path: "/archive/", label: "Archive", key: "archive" },
    { path: "/categories/", label: "Categories", key: "categories" },
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
  let navHTML =
    '<div class="post-nav-links" style="display: flex; justify-content: space-between; width: 100%; position: relative; margin-bottom: 60px;">';

  let leftButton = "";
  if (currentIndex > 0) {
    const prevPost = posts[currentIndex - 1];
    leftButton = `
      <a href="/${prevPost.url}/" class="nav-button">
        Previous 
      </a>
    `;
  }

  let rightButton = "";
  if (currentIndex < posts.length - 1) {
    const nextPost = posts[currentIndex + 1];
    rightButton = `
      <a href="/${nextPost.url}/" class="nav-button">
        Next 
      </a>
    `;
  }

  navHTML += `
    <div style="position: absolute; left: 25%; transform: translateX(-50%);">
      ${leftButton}
    </div>
    <div style="position: absolute; right: 25%; transform: translateX(50%);">
      ${rightButton}
    </div>
  `;

  navHTML += "</div>";
  return navHTML;
}

function generateArchivePage(postsByYear) {
  let archiveHTML = "";
  const sortedYears = Object.keys(postsByYear).sort((a, b) => b - a);

  sortedYears.forEach((year) => {
    archiveHTML += `<div class="archive-year"><h2 style="font-size: 1.5rem; margin: 20px 0 10px 0; color: #3d362e;">${year}</h2>`;

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

        if (index === 0) {
          archiveHTML += `
            <div style="margin-bottom: 12px; padding-left: 20px; display: flex; align-items: baseline;">
              <h3 style="font-size: 1.3rem; color: #6b5e4f; min-width: 100px;">${month}</h3>
              <div>
                <span style="color: #a0907d; font-size: 1.2rem;">${day}</span> &nbsp;&nbsp;-&nbsp;&nbsp;
                <a href="/${post.url}/" style="color: #4a453f; text-decoration: none;">${post.title}</a>
              </div>
            </div>
          `;
        } else {
          archiveHTML += `
            <div style="margin-bottom: 12px; padding-left: 120px;">
              <span style="color: #a0907d; font-size: 1.2rem;">${day}</span> &nbsp;&nbsp;-&nbsp;&nbsp;
              <a href="/${post.url}/" style="color: #4a453f; text-decoration: none;">${post.title}</a>
            </div>
          `;
        }
      });

      archiveHTML += "</div>";
    });

    archiveHTML += "</div>";
  });

  return archiveHTML;
}

function generateCategoriesPage(categorizedPosts) {
  let categoriesHTML = "";
  const sortedCategories = Object.keys(categorizedPosts).sort();

  sortedCategories.forEach((category) => {
    const posts = categorizedPosts[category];
    categoriesHTML += `<div class="archive-year"><h2 style="font-size: 1.5rem; margin: 20px 0 10px 0; color: #3d362e;">${category}</h2>`;

    posts.sort((a, b) => new Date(b.date) - new Date(a.date));

    posts.forEach((post) => {
      const date = new Date(post.date);
      const day = date.getDate().toString().padStart(2, "0");
      const month = date.toLocaleDateString("en-US", { month: "short" });
      const year = date.getFullYear();
      categoriesHTML += `
        <div style="margin-bottom: 12px; padding-left: 20px;">
          <span style="color: #a0907d; font-size: 1.2rem;">${year}&nbsp;&nbsp;&nbsp;${month}&nbsp;&nbsp;&nbsp;${day}</span> &nbsp;&nbsp;-&nbsp;&nbsp;
          <a href="/${post.url}/" style="color: #4a453f; text-decoration: none;">${post.title}</a>
        </div>
      `;
    });

    categoriesHTML += "</div>";
  });

  return categoriesHTML;
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
    .replace(/\{\{ASSETS_DIR\}\}/g, asset_dir);
}

function generateHeader(template, data, activeNav = null) {
  console.log("Generating header...");

  const navHTML = generateNavigation(activeNav);
  build;
  const html = template
    .replace(/\{\{SITE_TITLE\}\}/g, data.title)
    .replace(/\{\{NAVIGATION\}\}/g, navHTML);

  return html;
}

function generateFooter(template, data) {
  console.log("Generating footer...");

  const html = template
    .replace(/\{\{CURRENT_YEAR\}\}/g, new Date().getFullYear())
    .replace(/\{\{AUTHOR\}\}/g, data.author);

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

async function buildCategoriesPage(template, data) {
  console.log("Building categories page...");

  const categorizedPosts = groupPostsByCategory(data.posts);
  const categoriesHTML = generateCategoriesPage(categorizedPosts);

  const headHTML = generateHead(template.head, data, "../assets");
  const headerHTML = generateHeader(template.header, data, "categories");
  const footerHTML = generateFooter(template.footer, data);
  const html = template.categories
    .replace(/\{\{HEAD\}\}/g, headHTML)
    .replace(/\{\{HEADER\}\}/g, headerHTML)
    .replace(/\{\{CONTENT\}\}/g, categoriesHTML)
    .replace(/\{\{FOOTER\}\}/g, footerHTML);

  await ensureDir(`${CONFIG.OUTPUT_DIR}/categories`);
  await promises.writeFile(`${CONFIG.OUTPUT_DIR}/categories/index.html`, html);
  console.log("Built categories/index.html");
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
  await buildCategoriesPage(templates, data);
  await copyDirectory("src/assets", `${CONFIG.OUTPUT_DIR}/assets`);

  console.log("Blog build completed successfully!");
  console.log(
    `Generated ${data.posts.length + 4} pages in ${CONFIG.OUTPUT_DIR}/`,
  );
}

if (process.argv[1] === __filename) {
  build().catch((error) => {
    console.error("Build failed:", error);
    process.exit(1);
  });
}
