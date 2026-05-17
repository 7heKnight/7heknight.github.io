window.onload = function load_title() {
    let path = window.location.pathname.split("/").pop()
    let titleEl = document.getElementById("title");
    if (!titleEl) return;

    let titles = {
        "about.html": "About me",
        "category.html": "Category",
        "index.html": "Home Page",
        "copyright.html": "Copyright Page",
        "": "Home Page"
    };

    if (path in titles)
        titleEl.innerText = titles[path];
    else if (path.startsWith("post"))
        titleEl.innerText = "Reading blog";
    else
        titleEl.innerText = "Reading blog";
}

function show_table_category(){
    document.getElementById('category_header').style.backgroundColor = "black";
    document.getElementById('category_header').style.borderRadius = '10px';
}

function hide_table_category(){
    document.getElementById('category_header').style.backgroundColor = "#353535";
    document.getElementById('category_header').style.borderStyle = "none";
}